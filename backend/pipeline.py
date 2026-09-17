"""AI pipeline: synopsis/script text, character & scene images, Luma video."""
import base64
import json
import re
from typing import Optional

import requests
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

from core import EMERGENT_LLM_KEY, REPLICATE_API_TOKEN, new_id

TEXT_MODEL = ("openai", "gpt-5.4")
IMAGE_MODEL = "gemini-3.1-flash-image-preview"
REPLICATE_BASE = "https://api.replicate.com/v1"
LUMA_MODEL = "luma/ray-3.2"


def _orientation_hint(orientation: str) -> str:
    return "vertical 9:16 portrait composition" if orientation == "vertical" \
        else "horizontal 16:9 widescreen composition"


def _extract_json(text: str) -> dict:
    text = text.strip()
    # strip ```json fences
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


async def _chat_json(system: str, prompt: str) -> dict:
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=new_id(), system_message=system)
    chat.with_model(*TEXT_MODEL)
    resp = await chat.send_message(UserMessage(text=prompt))
    text = resp if isinstance(resp, str) else str(resp)
    return _extract_json(text)


# ---------------------------------------------------------------------------
# Synopsis
# ---------------------------------------------------------------------------
async def generate_synopsis(prompt: str, art_style: str, scene_count: int) -> dict:
    system = (
        "You are a master short-drama story editor for a vertical micro-drama studio. "
        "You craft punchy, emotionally-charged premises with strong hooks and cliffhangers. "
        "Always respond with strict minified JSON only, no prose, no markdown."
    )
    user = (
        f"Create a compelling short-drama episode from this idea:\n\"{prompt}\"\n\n"
        f"Visual style: {art_style}. The episode has {scene_count} scenes.\n"
        "Return JSON with exactly these keys:\n"
        '{"title": string (max 60 chars, catchy), '
        '"synopsis": string (2-3 vivid paragraphs, ~120-200 words, ending on a hook)}'
    )
    data = await _chat_json(system, user)
    return {"title": str(data.get("title", "")).strip()[:70],
            "synopsis": str(data.get("synopsis", "")).strip()}


# ---------------------------------------------------------------------------
# Script / manifest
# ---------------------------------------------------------------------------
async def generate_script(prompt: str, title: str, synopsis: str, art_style: str,
                          orientation: str, scene_count: int) -> dict:
    system = (
        "You are a professional screenwriter and cinematographer for AI-generated short "
        "dramas. You output detailed, production-ready screenplays as strict JSON. "
        "Character visual profiles must be extremely detailed and consistent so the same "
        "actor can be re-rendered across scenes. Respond with strict minified JSON only."
    )
    user = (
        f"Title: {title}\nPremise: {prompt}\nSynopsis: {synopsis}\n"
        f"Visual style: {art_style}. Orientation: {_orientation_hint(orientation)}.\n"
        f"Write exactly {scene_count} scenes.\n\n"
        "Return JSON with this exact schema:\n"
        "{"
        '"project_title": string, '
        '"global_style": string (one paragraph describing the consistent cinematic look, '
        'lighting, color grade, film stock and mood for the whole episode), '
        '"characters": [ { "id": UPPERCASE_SNAKE_CASE string unique id, "name": string, '
        '"role": string, "detailed_visual_profile": string (very detailed: age, ethnicity, '
        'hair, eyes, face shape, build, wardrobe, distinguishing features) } ], '
        '"scenes": [ { "scene_number": int starting at 1, "heading": string (e.g. '
        '"INT. CHEN MANSION - NIGHT"), "description": string (what happens), '
        '"visual_prompt": string (a rich cinematic image prompt for this shot, describing '
        'framing, subjects, environment, lighting and mood), "camera_movement": string, '
        '"dialogue": string (a short key line, may be empty), '
        '"character_focus": [character id strings that appear in this scene] } ]'
        "}\n"
        f"Include 2-4 characters. Ensure every scene_focus id exists in characters."
    )
    data = await _chat_json(system, user)
    # sanitize
    chars = []
    for c in data.get("characters", [])[:4]:
        cid = str(c.get("id") or c.get("name", "")).strip().upper().replace(" ", "_")
        if not cid:
            continue
        chars.append({
            "id": cid,
            "name": str(c.get("name", cid)).strip(),
            "role": str(c.get("role", "")).strip(),
            "detailed_visual_profile": str(c.get("detailed_visual_profile", "")).strip(),
        })
    valid_ids = {c["id"] for c in chars}
    scenes = []
    for i, s in enumerate(data.get("scenes", [])[:scene_count]):
        focus = [str(f).strip().upper().replace(" ", "_") for f in s.get("character_focus", [])]
        focus = [f for f in focus if f in valid_ids]
        scenes.append({
            "scene_number": i + 1,
            "heading": str(s.get("heading", f"SCENE {i + 1}")).strip(),
            "description": str(s.get("description", "")).strip(),
            "visual_prompt": str(s.get("visual_prompt", "")).strip(),
            "camera_movement": str(s.get("camera_movement", "")).strip(),
            "dialogue": str(s.get("dialogue", "")).strip(),
            "character_focus": focus or ([chars[0]["id"]] if chars else []),
        })
    return {
        "project_title": str(data.get("project_title", title)).strip(),
        "global_style": str(data.get("global_style", art_style)).strip(),
        "characters": chars,
        "scenes": scenes,
    }


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------
async def _generate_image(prompt: str, reference_images: Optional[list[bytes]] = None) -> bytes:
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=new_id(),
                   system_message="You are a world-class cinematic concept artist.")
    chat.with_model("gemini", IMAGE_MODEL).with_params(modalities=["image", "text"])
    file_contents = None
    if reference_images:
        file_contents = [ImageContent(base64.b64encode(b).decode("utf-8")) for b in reference_images]
    msg = UserMessage(text=prompt, file_contents=file_contents) if file_contents \
        else UserMessage(text=prompt)
    _, images = await chat.send_message_multimodal_response(msg)
    if not images:
        raise RuntimeError("Image generation returned no image")
    return base64.b64decode(images[0]["data"])


async def generate_character_image(global_style: str, profile: dict, orientation: str) -> bytes:
    prompt = (
        f"Full-body character reference portrait of {profile.get('name', 'a character')}. "
        f"{profile.get('detailed_visual_profile', '')}. "
        f"Cinematic {global_style}. Neutral studio backdrop, {_orientation_hint(orientation)}, "
        "sharp focus, high detail, single subject, natural expression, no text, no watermark."
    )
    return await _generate_image(prompt)


async def generate_scene_image(global_style: str, scene: dict, orientation: str,
                               reference_images: list[bytes]) -> bytes:
    prompt = (
        f"Cinematic film still storyboard frame. {scene.get('visual_prompt', '')}. "
        f"Camera: {scene.get('camera_movement', '')}. "
        f"Consistent look: {global_style}. {_orientation_hint(orientation)}. "
        "Reuse the exact same characters shown in the supplied reference images — keep their "
        "faces, hair, and wardrobe identical. Filmic lighting, high detail, no text, no watermark."
    )
    return await _generate_image(prompt, reference_images=reference_images or None)


# ---------------------------------------------------------------------------
# Video (Replicate + Luma Ray 3.2)
# ---------------------------------------------------------------------------
def build_motion_prompt(global_style: str, scene: dict, orientation: str) -> str:
    hint = "vertical 9:16" if orientation == "vertical" else "horizontal 16:9"
    return (
        f"Create one continuous five-second {hint} cinematic drama shot from the supplied first "
        f"frame. {scene.get('visual_prompt', '')}. Camera motion: "
        f"{scene.get('camera_movement', 'slow gentle push-in')}. Preserve the subject identity, "
        f"faces, wardrobe, lighting and color grade from the first frame. Consistent look: "
        f"{global_style}. Natural subtle motion, one continuous take, no cutaways, no transitions, "
        "no on-screen text, no subtitles. Do not generate any audio or soundtrack."
    )


class ReplicateError(RuntimeError):
    pass


def _replicate_headers() -> dict:
    if not REPLICATE_API_TOKEN or REPLICATE_API_TOKEN.startswith("REPLACE_WITH"):
        raise ReplicateError("Replicate API token is not configured yet. Add it in backend settings.")
    return {"Authorization": f"Bearer {REPLICATE_API_TOKEN}", "Content-Type": "application/json"}


def start_luma_prediction(prompt: str, start_image_url: str) -> dict:
    payload = {"input": {"prompt": prompt, "start_image": start_image_url, "duration": 5}}
    r = requests.post(f"{REPLICATE_BASE}/models/{LUMA_MODEL}/predictions",
                      headers=_replicate_headers(), json=payload, timeout=60)
    if r.status_code in (401, 403):
        raise ReplicateError("Replicate rejected the token or Luma Ray 3.2 access is not enabled.")
    if r.status_code == 429:
        raise ReplicateError("Replicate is rate-limiting or the account spend limit was reached. "
                             "Wait a moment and retry this scene.")
    if not r.ok:
        detail = ""
        try:
            detail = r.json().get("detail") or ""
        except Exception:
            detail = (r.text or "")[:200]
        raise ReplicateError(f"Could not start the Luma render ({r.status_code}). {detail}".strip())
    data = r.json()
    return {"prediction_id": data["id"], "status": _norm_status(data.get("status"))}


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


def _extract_video_url(output) -> Optional[str]:
    if isinstance(output, str) and output.startswith("https://"):
        return output
    if isinstance(output, list):
        for item in output:
            u = _extract_video_url(item)
            if u:
                return u
    if isinstance(output, dict):
        for k in ("video", "video_url", "url", "output"):
            u = _extract_video_url(output.get(k))
            if u:
                return u
    return None


def poll_luma_prediction(prediction_id: str) -> dict:
    r = requests.get(f"{REPLICATE_BASE}/predictions/{prediction_id}",
                     headers=_replicate_headers(), timeout=60)
    if not r.ok:
        raise ReplicateError("Could not fetch the render status. Please retry shortly.")
    data = r.json()
    status = _norm_status(data.get("status"))
    result = {"status": status}
    if status == "SUCCEEDED":
        result["output_url"] = _extract_video_url(data.get("output"))
    if status == "FAILED":
        result["error"] = "Luma could not finish this render. You can retry this scene."
    return result


def download_video(url: str) -> bytes:
    r = requests.get(url, headers={"Authorization": f"Bearer {REPLICATE_API_TOKEN}"},
                     timeout=180, allow_redirects=True)
    r.raise_for_status()
    return r.content
