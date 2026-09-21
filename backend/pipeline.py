"""AI pipeline faithful to the original reference (/tmp/buildy-reference).

Text (synopsis + screenplay manifest) via Emergent LLM, character & scene images
via Gemini Nano Banana, motion via Replicate Luma Ray 3.2, voices via ElevenLabs
(locked per character), lip-sync via Replicate pixverse/lipsync.
"""
import asyncio
import base64
import json
import os
import re
import subprocess
import tempfile
import time
from typing import Optional

import imageio_ffmpeg
import requests
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

from core import EMERGENT_LLM_KEY, REPLICATE_API_TOKEN, ELEVENLABS_API_KEY, new_id

TEXT_MODEL = ("openai", "gpt-5.4")
IMAGE_MODEL = "gemini-3.1-flash-image-preview"
REPLICATE_BASE = "https://api.replicate.com/v1"
LUMA_MODEL = "luma/ray-3.2"
PIXVERSE_MODEL = "pixverse/lipsync"

# Faithful to reference STYLE_PRESETS
STYLE_PRESETS = {
    "Live-Action Film": "Cinematic drama, high fidelity, 35mm film texture, photorealistic, moody low-key lighting, 8k framing",
    "Cinematic Drama": "Cinematic drama, high fidelity, 35mm film texture, photorealistic, moody low-key lighting, 8k framing",
    "American Illustration Style": "Bold American graphic-novel illustration, inked linework, dramatic cel shading, saturated cinematic color, high detail",
    "Japanese Anime Style": "High-end Japanese anime, clean linework, expressive eyes, cinematic anime lighting, detailed backgrounds, film-grade color",
    "Korean Manhwa Style": "Korean manhwa webtoon aesthetic, soft cel shading, romantic glossy rendering, delicate lighting, refined cinematic color",
    "Corporate Thriller": "High-stakes corporate thriller, sleek modern boardroom, cold blue and warm amber rim lights, hyper-realistic, 8k cinematic framing",
    "Cyberpunk Noir": "Cyberpunk neo-noir drama, rainy night city reflections, cyan and magenta rim lighting, cinematic lens flare, ultra-photorealistic",
    "Period Aristocracy": "Period aristocracy drama, grand candlelit ballroom, opulent velvet and gold filigree, soft romantic diffusion with intense dramatic shadows, 8k",
    "Psychological Suspense": "Psychological suspense thriller, desaturated color grade with sharp red highlights, dramatic chiaroscuro lighting, deep focus cinematic framing",
}


def resolve_global_style(art_style: str) -> str:
    return STYLE_PRESETS.get(art_style, STYLE_PRESETS["Live-Action Film"])


def orientation_label(orientation: str) -> str:
    return "Horizontal 16:9" if orientation == "horizontal" else "Vertical 9:16"


def _frame_direction(orientation: str, style: str = "long") -> str:
    if orientation == "horizontal":
        return "landscape-oriented 16:9" if style == "long" else "landscape 16:9"
    return "portrait-oriented 9:16" if style == "long" else "portrait 9:16"


def _extract_json(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


async def _chat_json(prompt: str) -> dict:
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=new_id(),
                   system_message="You output only strict minified JSON. No prose, no markdown.")
    chat.with_model(*TEXT_MODEL)
    resp = await chat.send_message(UserMessage(text=prompt))
    return _extract_json(resp if isinstance(resp, str) else str(resp))


# ---------------------------------------------------------------------------
# Synopsis (faithful to reference generateStorySetupProposal)
# ---------------------------------------------------------------------------
async def generate_synopsis(prompt: str, global_style: str, orientation: str,
                            scene_count: int, seed: int, story_so_far: str = "") -> dict:
    bounded = max(3, min(6, round(scene_count or 4)))
    frame = orientation_label(orientation)
    context = f"\n\nSerialized context — what happened in earlier episodes:\n{story_so_far}" if story_so_far else ""
    p = (
        "You are the setup editor for a premium short-form drama studio. Read the creator's raw "
        "story idea and prepare only the story setup for review.\n\n"
        "Return exactly two fields: title and synopsis. Do not write a screenplay, scene list, "
        "character list, dialogue, shot list, image prompt, or production instructions. The synopsis "
        "should be detailed enough for a creator to approve the premise before a separate screenplay "
        "pass, with a clear protagonist, central conflict, emotional stakes, escalation, and a "
        f"compelling final turn. Keep the synopsis in 2 to 4 readable paragraphs or roughly 160 to 260 "
        f"words. The project is planned as {bounded} scenes in {frame} framing, using this visual "
        f"direction: {global_style}. Treat the seed #{seed} as a continuity note only.{context}\n\n"
        f'Creator\'s raw story idea:\n"""\n{prompt.strip()}\n"""\n\n'
        'Return ONLY strict JSON: {"title": string (concise dramatic title), '
        '"synopsis": string}'
    )
    data = await _chat_json(p)
    title = str(data.get("title", "")).strip()[:160]
    synopsis = str(data.get("synopsis", "")).strip()[:5000]
    if len(synopsis) < 80:
        raise RuntimeError("Synopsis was not detailed enough. Please regenerate.")
    return {"title": title, "synopsis": synopsis}


# ---------------------------------------------------------------------------
# Screenplay manifest (faithful to reference generateDramaScript)
# ---------------------------------------------------------------------------
def _clean_id(v: str) -> str:
    return v.strip().upper().replace(" ", "_")


async def generate_script(prompt: str, synopsis: str, global_style: str, orientation: str,
                          scene_count: int, seed: int, story_so_far: str = "") -> dict:
    bounded = max(3, min(6, round(scene_count or 4)))
    frame = orientation_label(orientation)
    approved = synopsis.strip() if synopsis and synopsis.strip() else \
        "Expand the creator's premise into a coherent short drama before structuring scenes."
    context = f"\nSerialized context — earlier episodes:\n{story_so_far}\n" if story_so_far else ""

    system = (
        "You are an expert AI Screenwriter and Director specializing in viral short dramas (like "
        "ReelShort, DramaBox, EpNova). You craft a high-stakes, fast-paced, emotionally gripping "
        "drama scene script from the creator's approved setup.\n\n"
        "CRITICAL DIRECTIVES:\n"
        f"1. FORMAT: {frame} framing. Write exact visual camera movements appropriate for that "
        "composition (for example, a slow face push-in, a low-angle whip pan, or a wide lateral track).\n"
        "2. CHARACTER CONSISTENCY:\n"
        '   - Assign characters stable identifiers like "CHARACTER_A", "CHARACTER_B", "CHARACTER_C".\n'
        "   - For each character, author an ultra-detailed, photorealistic visual profile describing "
        "exact age, ethnic features, jawline, eye color, hair texture/style/color, signature "
        "outfit/fabrics, and distinctive marks.\n"
        "3. SCENES:\n"
        f"   - Generate EXACTLY {bounded} sequential scenes (numbered 1 through {bounded}).\n"
        "   - Each scene duration_seconds must be an integer of 3 or 4 seconds.\n"
        "   - Character dialogue must be brief and punchy. Some scenes may be action/atmosphere with "
        "no dialogue — for those use an empty dialogue string and an empty dialogue_lines array. For "
        "dialogue scenes include 1 to 3 speaker-tagged dialogue_lines, each with a stable safe ID such "
        'as "scene-1-line-1", a character_id from that scene\'s character_focus, short spoken text, '
        "and sequential order values starting at 1.\n"
        "   - The dialogue field must contain the dialogue_lines text joined in order with single spaces.\n"
        "   - Scene visual prompts must explicitly reference character IDs along with precise lighting, "
        "environment, and physical reaction.\n"
        "   - Every character in character_focus must match a character ID; every dialogue speaker must "
        "be in character_focus.\n"
        "   - Build escalation: Hook in Scene 1, Conflict & Escalation in the middle, a Shocking Twist "
        "or Cliffhanger in the final scene.\n"
        f"4. LOCKED SEED REFERENCE: Global project seed is #{seed}."
    )
    user = (
        f'Creator\'s raw premise (creative story narrative only):\n"""\n{prompt}\n"""\n{context}\n'
        f'Approved story setup synopsis:\n"""\n{approved}\n"""\n\n'
        f"Target Scene Count: EXACTLY {bounded}\nOutput Orientation: {frame}\n"
        f"Global Visual Style: {global_style}\n\n"
        "Return ONLY strict JSON matching this schema:\n"
        '{"project_title": string, "global_style": string, '
        '"characters": [{"id": "CHARACTER_A", "detailed_visual_profile": string, "name": string}], '
        '"scenes": [{"scene_number": int, "character_focus": [id], "visual_prompt": string, '
        '"camera_movement": string, "dialogue": string, '
        '"dialogue_lines": [{"line_id": string, "character_id": id, "text": string, "order": int}], '
        '"duration_seconds": 3 or 4}]}'
    )
    data = await _chat_json(f"{system}\n\n{user}")
    return _validate_manifest(data, bounded, global_style)


def _validate_manifest(raw: dict, expected_scenes: int, fallback_style: str) -> dict:
    title = str(raw.get("project_title", "")).strip() or "Untitled Episode"
    gstyle = str(raw.get("global_style", "")).strip() or fallback_style
    chars, ids = [], set()
    for i, c in enumerate(raw.get("characters", [])[:6]):
        cid = _clean_id(str(c.get("id") or c.get("name", f"CHARACTER_{chr(65+i)}")))
        if not cid or cid in ids:
            continue
        prof = str(c.get("detailed_visual_profile", "")).strip()
        if not prof:
            continue
        ids.add(cid)
        chars.append({"id": cid, "name": str(c.get("name", cid)).strip() or cid,
                      "detailed_visual_profile": prof})
    if not chars:
        raise RuntimeError("Screenplay did not include valid characters.")
    scenes = []
    raw_scenes = raw.get("scenes", [])[:expected_scenes]
    for i, s in enumerate(raw_scenes):
        num = i + 1
        focus = [_clean_id(str(f)) for f in s.get("character_focus", []) if str(f).strip()]
        focus = [f for f in dict.fromkeys(focus) if f in ids] or [chars[0]["id"]]
        lines_raw = s.get("dialogue_lines") or []
        lines = []
        for j, ln in enumerate(lines_raw[:3]):
            cid = _clean_id(str(ln.get("character_id", "")))
            txt = str(ln.get("text", "")).strip()
            if not txt or cid not in focus:
                continue
            lines.append({"line_id": f"scene-{num}-line-{j+1}", "character_id": cid,
                          "text": txt, "order": len(lines) + 1})
        dialogue = " ".join(l["text"] for l in lines) if lines else str(s.get("dialogue", "")).strip()
        dur = s.get("duration_seconds")
        dur = dur if dur in (3, 4) else 4
        scenes.append({
            "scene_number": num,
            "character_focus": focus,
            "visual_prompt": str(s.get("visual_prompt", "")).strip(),
            "camera_movement": str(s.get("camera_movement", "slow cinematic push-in")).strip(),
            "dialogue": dialogue,
            "dialogue_lines": lines,
            "duration_seconds": dur,
        })
    if not scenes:
        raise RuntimeError("Screenplay did not include valid scenes.")
    return {"project_title": title, "global_style": gstyle, "characters": chars, "scenes": scenes}


# ---------------------------------------------------------------------------
# Images (faithful reference prompts)
# ---------------------------------------------------------------------------
async def _generate_image(prompt: str, reference_images: Optional[list[bytes]] = None) -> bytes:
    files = [ImageContent(base64.b64encode(b).decode("utf-8")) for b in (reference_images or [])]
    last_err: Optional[Exception] = None
    for attempt in range(3):
        try:
            chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=new_id(),
                           system_message="You are a world-class cinematic concept artist.")
            chat.with_model("gemini", IMAGE_MODEL).with_params(modalities=["image", "text"])
            msg = UserMessage(text=prompt, file_contents=files) if files else UserMessage(text=prompt)
            _, images = await chat.send_message_multimodal_response(msg)
            if images:
                return base64.b64decode(images[0]["data"])
            last_err = RuntimeError("Image generation returned no image")
        except Exception as e:  # transient upstream errors (e.g. 502) — retry a couple of times
            last_err = e
        if attempt < 2:
            await asyncio.sleep(1.5 * (attempt + 1))
    raise last_err or RuntimeError("Image generation failed")


def build_character_reference_prompt(character: dict, global_style: str, seed: int, orientation: str) -> str:
    frame = _frame_direction(orientation, "long")
    return (
        f"Create a neutral character reference sheet for a private short-drama production in {frame} format.\n\n"
        f"Character ID: {character['id']}\nFull detailed visual profile:\n{character['detailed_visual_profile']}\n\n"
        f"Global visual style:\n{global_style}\n\n"
        f"Composition direction: one clearly visible character, {frame} framing, head and shoulders with "
        "enough wardrobe detail to recognize the silhouette, neutral expression, relaxed posture, clean "
        "studio-like background, even cinematic key light, no action pose, no dialogue, no props that "
        "obscure the face, no text or watermarks. This is a neutral visual reference image for later "
        f"storyboard conditioning, not a finished scene.\n\nProject seed anchor: #{seed}. Use this number "
        "as a textual consistency cue alongside the profile."
    )


def build_scene_storyboard_prompt(scene: dict, characters: list[dict], global_style: str,
                                  seed: int, orientation: str) -> str:
    frame = _frame_direction(orientation, "short")
    by_id = {c["id"]: c for c in characters}
    profiles = "\n".join(f"{cid}: {by_id[cid]['detailed_visual_profile']}"
                         for cid in scene["character_focus"] if cid in by_id)
    return (
        f"Create a cinematic storyboard image for Scene {scene['scene_number']} of a short drama in {frame} format.\n\n"
        f"Global visual style:\n{global_style}\n\nExact scene visual prompt:\n{scene['visual_prompt']}\n\n"
        f"Exact camera movement direction to imply in the still composition:\n{scene['camera_movement']}\n\n"
        f"Characters in focus and their full visual profiles:\n{profiles}\n\n"
        f"Frame direction: {frame} composition, strong foreground and background depth, expressive physical "
        "action frozen at a dramatic beat, clear faces and wardrobe, lighting that matches the global style, "
        "polished cinematic realism, no subtitles, no logos, no watermarks, no extra characters. Reuse the "
        "exact same characters from the supplied reference images — keep their faces, hair, and wardrobe "
        f"identical.\n\nProject seed anchor: #{seed}."
    )


async def generate_character_image(character: dict, global_style: str, seed: int, orientation: str) -> bytes:
    return await _generate_image(build_character_reference_prompt(character, global_style, seed, orientation))


async def generate_scene_image(scene: dict, characters: list[dict], global_style: str, seed: int,
                               orientation: str, reference_images: list[bytes]) -> bytes:
    return await _generate_image(
        build_scene_storyboard_prompt(scene, characters, global_style, seed, orientation),
        reference_images=reference_images or None)


# ---------------------------------------------------------------------------
# Replicate (Luma motion + PixVerse lip-sync share the predictions API)
# ---------------------------------------------------------------------------
class ProviderError(RuntimeError):
    pass


def _replicate_headers() -> dict:
    if not REPLICATE_API_TOKEN or REPLICATE_API_TOKEN.startswith("REPLACE_WITH"):
        raise ProviderError("Replicate API token is not configured yet.")
    return {"Authorization": f"Bearer {REPLICATE_API_TOKEN}", "Content-Type": "application/json"}


def _norm_status(value) -> str:
    s = (value or "").lower()
    if s in ("starting", "queued"):
        return "QUEUED"
    if s in ("processing", "running"):
        return "PROCESSING"
    if s in ("succeeded", "completed"):
        return "SUCCEEDED"
    if s in ("failed", "error"):
        return "FAILED"
    if s in ("canceled", "cancelled"):
        return "CANCELED"
    return "QUEUED"


def _extract_url(output) -> Optional[str]:
    if isinstance(output, str) and output.startswith("https://"):
        return output
    if isinstance(output, list):
        for item in output:
            u = _extract_url(item)
            if u:
                return u
    if isinstance(output, dict):
        for k in ("video", "video_url", "url", "output", "file_url"):
            u = _extract_url(output.get(k))
            if u:
                return u
    return None


def replicate_start(model: str, inp: dict) -> dict:
    last_detail = ""
    for attempt in range(3):
        r = requests.post(f"{REPLICATE_BASE}/models/{model}/predictions",
                          headers=_replicate_headers(), json={"input": inp}, timeout=60)
        if r.status_code in (401, 403):
            raise ProviderError(f"Replicate rejected the token or {model} access is not enabled.")
        if r.status_code == 429:
            raise ProviderError("Replicate is rate-limiting or the account spend limit was reached. Retry shortly.")
        if r.ok:
            data = r.json()
            return {"prediction_id": data["id"], "status": _norm_status(data.get("status"))}
        try:
            last_detail = r.json().get("detail") or ""
        except Exception:
            last_detail = (r.text or "")[:200]
        if r.status_code in (500, 502, 503, 504) and attempt < 2:
            time.sleep(1.5 * (attempt + 1))  # transient gateway hiccup — retry
            continue
        break
    raise ProviderError(f"Could not start {model}. {last_detail}".strip())


def replicate_poll(prediction_id: str) -> dict:
    r = requests.get(f"{REPLICATE_BASE}/predictions/{prediction_id}",
                     headers=_replicate_headers(), timeout=60)
    if not r.ok:
        raise ProviderError("Could not fetch the render status. Please retry shortly.")
    data = r.json()
    status = _norm_status(data.get("status"))
    out = {"status": status}
    if status == "SUCCEEDED":
        out["output_url"] = _extract_url(data.get("output"))
    if status in ("FAILED", "CANCELED"):
        raw = str(data.get("error") or "").lower()
        if any(k in raw for k in ("content", "moderat", "policy", "sensitive", "flagged")):
            out["error"] = ("This shot was blocked by the video model's content policy. "
                            "Soften the scene or dialogue wording, then retry.")
        else:
            out["error"] = "The render could not finish. You can retry this shot."
    return out


def download_replicate_file(url: str) -> bytes:
    r = requests.get(url, headers={"Authorization": f"Bearer {REPLICATE_API_TOKEN}"},
                     timeout=180, allow_redirects=True)
    r.raise_for_status()
    return r.content


def build_master_motion_prompt(global_style: str, scene: dict, orientation: str) -> str:
    hint = "vertical 9:16" if orientation == "vertical" else "horizontal 16:9"
    return (
        f"Animate this storyboard into one continuous five-second {hint} cinematic drama shot. "
        f"{scene.get('visual_prompt', '')}. Camera motion: {scene.get('camera_movement', 'slow gentle push-in')}. "
        "Preserve the subject identity, faces, wardrobe, lighting and color grade from the first frame. "
        f"Consistent look: {global_style}. Natural subtle motion, one continuous take, no cutaways, no "
        "transitions, no on-screen text, no subtitles. Do not generate any audio or soundtrack."
    )


def start_luma_motion(prompt: str, start_image_url: str) -> dict:
    return replicate_start(LUMA_MODEL, {"prompt": prompt, "start_image": start_image_url, "duration": 5})


def build_dialogue_closeup_prompt(global_style: str, scene: dict, character: dict,
                                  line_text: str, orientation: str) -> str:
    """Per-line speaking close-up of a SINGLE character (faithful to reference
    buildDialogueCloseupPrompt). This guarantees only the speaking character is
    in frame so the lip-sync animates the correct face.

    The scene's raw action/visual prompt is intentionally NOT included: a talking
    close-up only needs the character's identity, style and the spoken line, and
    including violent/physical scene action ('lunges', 'grabs', etc.) trips the
    video model's content-moderation filter and makes the shot fail."""
    hint = "vertical 9:16" if orientation == "vertical" else "horizontal 16:9"
    parts = [
        f"Create one continuous five-second {hint} cinematic drama speaking close-up from the supplied first frame.",
        "Use the saved character reference as the exact first frame and preserve the subject's identity, "
        "face, hair, wardrobe, lighting, and color grade.",
        f"Frame {character['id']} in a tight medium or head-and-shoulders shot with a frontal or near-frontal "
        "face, readable eyes, and an unobstructed mouth.",
        "Keep a single speaker only — no other people, cutaways, transitions, scene changes, subtitles, "
        "logos, or text overlays. Use steady restrained head movement and minimal camera motion; keep the "
        "performance intimate, natural and controlled.",
        "The mouth movement is visual performance guidance only. Do not generate audio and do not embed a voice or soundtrack.",
        f"Global visual style: {global_style}" if global_style else "",
        f"Saved character profile: {character.get('detailed_visual_profile', '')}" if character.get("detailed_visual_profile") else "",
        f'The character is delivering this exact spoken line (for mouth-timing guidance only): "{line_text}"',
    ]
    return "\n".join(p for p in parts if p)


def start_luma_closeup(prompt: str, start_image_url: str) -> dict:
    return replicate_start(LUMA_MODEL, {"prompt": prompt, "start_image": start_image_url, "duration": 5})


def start_pixverse_lipsync(video_url: str, audio_url: str) -> dict:
    return replicate_start(PIXVERSE_MODEL, {"video": video_url, "audio": audio_url})


# ---------------------------------------------------------------------------
# ElevenLabs (faithful reference settings)
# ---------------------------------------------------------------------------
ELEVEN_VOICES_URL = "https://api.elevenlabs.io/v2/voices?page_size=100"
ELEVEN_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech"


def _eleven_headers() -> dict:
    if not ELEVENLABS_API_KEY:
        raise ProviderError("The ElevenLabs voice key is not configured yet.")
    return {"xi-api-key": ELEVENLABS_API_KEY}


def list_voices() -> list[dict]:
    r = requests.get(ELEVEN_VOICES_URL, headers={**_eleven_headers(), "Accept": "application/json"}, timeout=30)
    if r.status_code in (401, 403):
        raise ProviderError("ElevenLabs rejected the voice key.")
    if not r.ok:
        raise ProviderError("Could not load ElevenLabs voices. Retry shortly.")
    voices = r.json().get("voices", [])
    out = []
    for v in voices:
        labels = v.get("labels") or {}
        out.append({
            "voice_id": v.get("voice_id"),
            "name": v.get("name"),
            "gender": labels.get("gender"),
            "accent": labels.get("accent"),
            "description": v.get("description") or labels.get("description"),
            "category": v.get("category"),
        })
    return [v for v in out if v["voice_id"] and v["name"]]


def synthesize_voice(voice_id: str, text: str) -> bytes:
    r = requests.post(
        f"{ELEVEN_TTS_URL}/{voice_id}?output_format=mp3_44100_128",
        headers={**_eleven_headers(), "Content-Type": "application/json"},
        json={
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.52, "similarity_boost": 0.78,
                               "style": 0.12, "use_speaker_boost": True},
        },
        timeout=90,
    )
    if r.status_code in (401, 403):
        raise ProviderError("ElevenLabs rejected the voice key.")
    if not r.ok:
        raise ProviderError("ElevenLabs could not synthesize this line. Retry shortly.")
    return r.content


# ---------------------------------------------------------------------------
# Final cut — stitch the episode's shots (establishing masters + dialogue
# close-ups, in order) into one downloadable MP4 with audio. Uses a bundled
# static ffmpeg (imageio-ffmpeg) — no AI credits, works in dev and production.
# ---------------------------------------------------------------------------
def _ffmpeg_exe() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def stitch_episode(clips: list, orientation: str) -> bytes:
    """clips: ordered list of (mp4_bytes, has_audio). Masters are silent (has_audio
    False) and get a silent track; dialogue close-ups keep their voice audio. Every
    clip is normalized to a common canvas + 24fps + stereo AAC so the concat is clean."""
    if not clips:
        raise RuntimeError("Nothing to stitch yet.")
    w, h = (1280, 720) if orientation == "horizontal" else (720, 1280)
    vf = (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
          f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=24,format=yuv420p")
    ff = _ffmpeg_exe()
    with tempfile.TemporaryDirectory() as td:
        norm_files = []
        for i, (data, has_audio) in enumerate(clips):
            src = os.path.join(td, f"src{i}.mp4")
            out = os.path.join(td, f"norm{i}.mp4")
            with open(src, "wb") as f:
                f.write(data)
            common = ["-vf", vf, "-r", "24", "-c:v", "libx264", "-preset", "veryfast",
                      "-crf", "23", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k",
                      "-shortest", out]
            if has_audio:
                cmd = [ff, "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0"] + common
            else:
                cmd = [ff, "-y", "-i", src, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                       "-map", "0:v:0", "-map", "1:a:0"] + common
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if r.returncode != 0 or not os.path.exists(out):
                raise RuntimeError(f"Could not normalize clip {i + 1}: {(r.stderr or '')[-300:]}")
            norm_files.append(out)
        list_path = os.path.join(td, "concat.txt")
        with open(list_path, "w") as f:
            for nf in norm_files:
                f.write(f"file '{nf}'\n")
        final = os.path.join(td, "final.mp4")
        cmd = [ff, "-y", "-f", "concat", "-safe", "0", "-i", list_path,
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-ar", "44100", "-movflags", "+faststart", final]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if r.returncode != 0 or not os.path.exists(final):
            raise RuntimeError(f"Could not assemble the final cut: {(r.stderr or '')[-300:]}")
        with open(final, "rb") as f:
            return f.read()
