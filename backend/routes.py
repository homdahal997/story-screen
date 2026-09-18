"""Frame Studio API — series (projects) with lazy episodes and the full
reference pipeline: synopsis -> script -> assets -> motion -> voice -> lip-sync."""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field, field_validator

import core
import pipeline

router = APIRouter(prefix="/api")

EPISODE_SCENES = 5  # scenes per episode (targets a ~1 minute assembled episode)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class SignupBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)

    @field_validator("password")
    @classmethod
    def _bytes(cls, v: str) -> str:
        if len(v.encode("utf-8")) > 72:
            raise ValueError("password too long")
        return v


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class SeriesBody(BaseModel):
    title: str = Field(default="", max_length=70)
    prompt: str = Field(min_length=1, max_length=20000)
    orientation: str = "vertical"
    art_style: str = "Live-Action Film"
    total_episodes: int = Field(default=10, ge=1, le=120)


class VoiceBody(BaseModel):
    voice_id: str
    voice_name: str = ""


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def public_user(u: dict) -> dict:
    return {"id": u["id"], "name": u.get("name", ""), "email": u["email"],
            "created_at": u.get("created_at")}


async def get_series(project_id: str, user: dict) -> dict:
    p = await core.db.projects.find_one(
        {"id": project_id, "owner_id": user["id"], "deleted_at": None}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Series not found")
    return p


async def get_episode_doc(project_id: str, n: int, user: dict, create: bool = False) -> Optional[dict]:
    ep = await core.db.episodes.find_one(
        {"project_id": project_id, "owner_id": user["id"], "episode_number": n}, {"_id": 0})
    if ep or not create:
        return ep
    ep = {
        "id": core.new_id(), "project_id": project_id, "owner_id": user["id"],
        "episode_number": n, "status": "DRAFT", "synopsis": "", "manifest": None,
        "frame_assets": [], "video_clips": [], "voice_assignments": [],
        "audio_assets": [], "closeup_clips": [], "lipsync_clips": [],
        "created_at": core.now_iso(), "updated_at": core.now_iso(),
    }
    await core.db.episodes.insert_one(ep)
    return ep


async def ep_update(episode_id: str, changes: dict) -> dict:
    changes["updated_at"] = core.now_iso()
    await core.db.episodes.update_one({"id": episode_id}, {"$set": changes})
    return await core.db.episodes.find_one({"id": episode_id}, {"_id": 0})


# ---------------------------------------------------------------------------
# Status / serialization
# ---------------------------------------------------------------------------
def _asset(ep: dict, atype: str, *, character_id=None, scene_number=None):
    for a in ep.get("frame_assets", []):
        if a.get("asset_type") != atype:
            continue
        if character_id is not None and a.get("character_id") == character_id:
            return a
        if scene_number is not None and a.get("scene_number") == scene_number:
            return a
    return None


def _master_clip(ep: dict, scene_number: int):
    return next((c for c in ep.get("video_clips", []) if c["scene_number"] == scene_number), None)


def _line_audio(ep: dict, scene_number: int, line_id: str):
    return next((a for a in ep.get("audio_assets", [])
                 if a["scene_number"] == scene_number and a["line_id"] == line_id), None)


def _line_shot(ep: dict, scene_number: int, line_id: str):
    return next((c for c in ep.get("lipsync_clips", [])
                 if c["scene_number"] == scene_number and c["line_id"] == line_id), None)


def _line_closeup(ep: dict, scene_number: int, line_id: str):
    return next((c for c in ep.get("closeup_clips", [])
                 if c["scene_number"] == scene_number and c["line_id"] == line_id), None)


def episode_is_ready(ep: dict) -> bool:
    manifest = ep.get("manifest")
    if not manifest:
        return False
    for s in manifest["scenes"]:
        clip = _master_clip(ep, s["scene_number"])
        if not clip or clip.get("status") != "READY":
            return False
        for line in s.get("dialogue_lines", []):
            shot = _line_shot(ep, s["scene_number"], line["line_id"])
            if not shot or shot.get("status") != "READY":
                return False
    return True


def episode_status(ep: dict) -> str:
    manifest = ep.get("manifest")
    if not ep.get("synopsis"):
        return "DRAFT"
    if not manifest:
        return "SYNOPSIS"
    chars_done = all(_asset(ep, "character_reference", character_id=c["id"]) for c in manifest["characters"])
    boards_done = all(_asset(ep, "scene_storyboard", scene_number=s["scene_number"]) for s in manifest["scenes"])
    if not (chars_done and boards_done):
        return "ASSETS"
    motion_done = all((_master_clip(ep, s["scene_number"]) or {}).get("status") == "READY"
                      for s in manifest["scenes"])
    if not motion_done:
        return "MOTION"
    if episode_is_ready(ep):
        return "READY"
    return "VOICE"


def serialize_episode(series: dict, ep: dict) -> dict:
    manifest = ep.get("manifest")
    orientation = series.get("orientation", "vertical")
    characters, scenes = [], []
    if manifest:
        voices = {v["character_id"]: v for v in _normalize_assignments(ep.get("voice_assignments", []), manifest)}
        for c in manifest["characters"]:
            asset = _asset(ep, "character_reference", character_id=c["id"])
            v = voices.get(c["id"])
            characters.append({
                **c,
                "image_url": core.media_url(asset["storage_path"]) if asset else None,
                "voice": {"voice_id": v["voice_id"], "voice_name": v["voice_name"]} if v else None,
            })
        for s in manifest["scenes"]:
            sb = _asset(ep, "scene_storyboard", scene_number=s["scene_number"])
            master = _master_clip(ep, s["scene_number"])
            master_out = None
            if master:
                master_out = {"status": master.get("status"), "error": master.get("error"),
                              "video_url": core.media_url(master["storage_path"]) if master.get("storage_path") else None}
            lines = []
            for line in s.get("dialogue_lines", []):
                audio = _line_audio(ep, s["scene_number"], line["line_id"])
                shot = _line_shot(ep, s["scene_number"], line["line_id"])
                lines.append({
                    **line,
                    "audio_url": core.media_url(audio["storage_path"]) if audio else None,
                    "shot": {"status": shot.get("status"), "error": shot.get("error"),
                             "video_url": core.media_url(shot["storage_path"]) if shot.get("storage_path") else None}
                    if shot else None,
                })
            scenes.append({
                **s,
                "storyboard_url": core.media_url(sb["storage_path"]) if sb else None,
                "master": master_out,
                "lines": lines,
            })
    # Preview playlist (master then dialogue shots, in scene order)
    shots = []
    for s in scenes:
        if s["master"] and s["master"]["video_url"]:
            shots.append({"type": "master", "scene_number": s["scene_number"], "video_url": s["master"]["video_url"]})
        for line in s["lines"]:
            if line["shot"] and line["shot"]["video_url"]:
                shots.append({"type": "dialogue", "scene_number": s["scene_number"],
                              "line_id": line["line_id"], "video_url": line["shot"]["video_url"]})
    return {
        "id": ep["id"],
        "project_id": ep["project_id"],
        "episode_number": ep["episode_number"],
        "status": episode_status(ep),
        "ready": episode_is_ready(ep),
        "orientation": orientation,
        "synopsis": ep.get("synopsis", ""),
        "global_style": manifest.get("global_style", "") if manifest else "",
        "characters": characters,
        "scenes": scenes,
        "preview": {"shots": shots, "total_seconds": len(shots) * 5},
        "series_title": series.get("title", ""),
    }


async def serialize_series(series: dict, user: dict) -> dict:
    eps = {e["episode_number"]: e async for e in core.db.episodes.find(
        {"project_id": series["id"], "owner_id": user["id"]}, {"_id": 0})}
    ep1 = eps.get(1)
    ep1_ready = bool(ep1 and episode_is_ready(ep1))
    episodes = []
    for n in range(1, series.get("total_episodes", 1) + 1):
        e = eps.get(n)
        locked = n > 1 and not ep1_ready
        episodes.append({
            "episode_number": n,
            "status": episode_status(e) if e else "NOT_STARTED",
            "ready": bool(e and episode_is_ready(e)),
            "locked": locked,
            "started": bool(e),
        })
    return {
        "id": series["id"],
        "title": series.get("title", ""),
        "prompt": series.get("prompt", ""),
        "orientation": series.get("orientation", "vertical"),
        "art_style": series.get("art_style", ""),
        "total_episodes": series.get("total_episodes", 1),
        "episodes": episodes,
        "ep1_ready": ep1_ready,
        "created_at": series.get("created_at"),
        "updated_at": series.get("updated_at"),
    }


async def guard_unlocked(series: dict, n: int, user: dict):
    """Episodes 2..N are locked until episode 1 is fully ready."""
    if n <= 1:
        return
    ep1 = await get_episode_doc(series["id"], 1, user)
    if not (ep1 and episode_is_ready(ep1)):
        raise HTTPException(status_code=403, detail="Complete Episode 1 first to unlock this episode.")


async def prior_context(series: dict, n: int, user: dict) -> str:
    if n <= 1:
        return ""
    parts = []
    async for e in core.db.episodes.find(
            {"project_id": series["id"], "owner_id": user["id"], "episode_number": {"$lt": n}},
            {"_id": 0}).sort("episode_number", 1):
        if e.get("synopsis"):
            parts.append(f"Episode {e['episode_number']}: {e['synopsis']}")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@router.post("/auth/signup")
async def signup(body: SignupBody):
    email = str(body.email).strip().lower()
    if await core.db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email is already registered")
    user = {"id": core.new_id(), "name": body.name.strip(), "email": email,
            "hashed_password": core.hash_password(body.password), "created_at": core.now_iso()}
    await core.db.users.insert_one(user)
    return {"token": core.make_access_token(user["id"]), "user": public_user(user)}


@router.post("/auth/login")
async def login(body: LoginBody):
    email = str(body.email).strip().lower()
    user = await core.db.users.find_one({"email": email})
    stored = user["hashed_password"] if user else core.DUMMY_HASH
    if not user or not core.verify_password(body.password, stored):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return {"token": core.make_access_token(user["id"]), "user": public_user(user)}


@router.get("/auth/me")
async def me(user: core.CurrentUser):
    return public_user(user)


# ---------------------------------------------------------------------------
# Series (projects)
# ---------------------------------------------------------------------------
@router.post("/projects")
async def create_series(body: SeriesBody, user: core.CurrentUser):
    series = {
        "id": core.new_id(), "owner_id": user["id"], "title": body.title.strip(),
        "prompt": body.prompt.strip(), "orientation": body.orientation,
        "art_style": body.art_style, "global_style": pipeline.resolve_global_style(body.art_style),
        "total_episodes": body.total_episodes, "seed": core.new_seed(),
        "created_at": core.now_iso(), "updated_at": core.now_iso(), "deleted_at": None,
    }
    await core.db.projects.insert_one(series)
    return await serialize_series(series, user)


@router.get("/projects")
async def list_series(user: core.CurrentUser):
    cursor = core.db.projects.find({"owner_id": user["id"], "deleted_at": None}, {"_id": 0}).sort("created_at", -1)
    return [await serialize_series(p, user) async for p in cursor]


@router.get("/projects/{project_id}")
async def get_one_series(project_id: str, user: core.CurrentUser):
    return await serialize_series(await get_series(project_id, user), user)


@router.delete("/projects/{project_id}")
async def delete_series(project_id: str, user: core.CurrentUser):
    await get_series(project_id, user)
    await core.db.projects.update_one({"id": project_id}, {"$set": {"deleted_at": core.now_iso()}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Episode read
# ---------------------------------------------------------------------------
@router.get("/projects/{project_id}/episodes/{n}")
async def get_episode(project_id: str, n: int, user: core.CurrentUser):
    series = await get_series(project_id, user)
    if n < 1 or n > series.get("total_episodes", 1):
        raise HTTPException(status_code=404, detail="Episode out of range")
    await guard_unlocked(series, n, user)
    ep = await get_episode_doc(project_id, n, user, create=True)
    return serialize_episode(series, ep)


async def _load_pipeline_episode(project_id: str, n: int, user: dict):
    series = await get_series(project_id, user)
    await guard_unlocked(series, n, user)
    ep = await get_episode_doc(project_id, n, user, create=True)
    return series, ep


# ---------------------------------------------------------------------------
# Pipeline: synopsis + script
# ---------------------------------------------------------------------------
@router.post("/projects/{project_id}/episodes/{n}/synopsis")
async def gen_synopsis(project_id: str, n: int, user: core.CurrentUser):
    series, ep = await _load_pipeline_episode(project_id, n, user)
    ctx = await prior_context(series, n, user)
    premise = f"{series['prompt']}\n\nThis is Episode {n} of the series." if n > 1 else series["prompt"]
    try:
        result = await pipeline.generate_synopsis(
            premise, series["global_style"], series["orientation"], EPISODE_SCENES, series["seed"], ctx)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Synopsis generation failed: {e}")
    ep = await ep_update(ep["id"], {"synopsis": result["synopsis"], "status": "SYNOPSIS",
                                    "proposed_title": result["title"]})
    if n == 1 and not series.get("title"):
        await core.db.projects.update_one({"id": project_id},
                                          {"$set": {"title": result["title"], "updated_at": core.now_iso()}})
        series = await get_series(project_id, user)
    return serialize_episode(series, ep)


@router.post("/projects/{project_id}/episodes/{n}/script")
async def gen_script(project_id: str, n: int, user: core.CurrentUser):
    series, ep = await _load_pipeline_episode(project_id, n, user)
    if not ep.get("synopsis"):
        raise HTTPException(status_code=400, detail="Generate the synopsis first")
    ctx = await prior_context(series, n, user)
    try:
        manifest = await pipeline.generate_script(
            series["prompt"], ep["synopsis"], series["global_style"], series["orientation"],
            EPISODE_SCENES, series["seed"], ctx)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Script generation failed: {e}")
    ep = await ep_update(ep["id"], {"manifest": manifest, "status": "ASSETS"})
    # Lock a distinct voice per character up-front (deterministic, single request
    # -> no race). Best-effort: if voices can't be listed now, they are cast lazily.
    try:
        assignments = _cast_all_voices(series, manifest, [])
        ep = await ep_update(ep["id"], {"voice_assignments": assignments})
    except Exception:
        pass
    return serialize_episode(series, ep)


# ---------------------------------------------------------------------------
# Pipeline: images
# ---------------------------------------------------------------------------
@router.post("/projects/{project_id}/episodes/{n}/characters/{cid}/image")
async def gen_character_image(project_id: str, n: int, cid: str, user: core.CurrentUser):
    series, ep = await _load_pipeline_episode(project_id, n, user)
    manifest = ep.get("manifest")
    if not manifest:
        raise HTTPException(status_code=400, detail="Generate the script first")
    profile = next((c for c in manifest["characters"] if c["id"] == cid), None)
    if not profile:
        raise HTTPException(status_code=404, detail="Character not found")
    try:
        img = await pipeline.generate_character_image(profile, manifest["global_style"],
                                                      series["seed"], series["orientation"])
        path = await core.store_bytes(user["id"], img, "png", "image/png")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Character image failed: {e}")
    assets = [a for a in ep.get("frame_assets", [])
              if not (a.get("asset_type") == "character_reference" and a.get("character_id") == cid)]
    assets.append({"asset_type": "character_reference", "character_id": cid,
                   "storage_path": path, "created_at": core.now_iso()})
    ep = await ep_update(ep["id"], {"frame_assets": assets})
    return serialize_episode(series, ep)


@router.post("/projects/{project_id}/episodes/{n}/scenes/{s}/storyboard")
async def gen_storyboard(project_id: str, n: int, s: int, user: core.CurrentUser):
    series, ep = await _load_pipeline_episode(project_id, n, user)
    manifest = ep.get("manifest")
    if not manifest:
        raise HTTPException(status_code=400, detail="Generate the script first")
    scene = next((sc for sc in manifest["scenes"] if sc["scene_number"] == s), None)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    refs = []
    for cid in scene["character_focus"]:
        a = _asset(ep, "character_reference", character_id=cid)
        if a:
            try:
                data, _ = await core.load_bytes(a["storage_path"])
                refs.append(data)
            except Exception:
                pass
    if not refs:
        raise HTTPException(status_code=400, detail="Generate the character images for this scene first")
    try:
        img = await pipeline.generate_scene_image(scene, manifest["characters"], manifest["global_style"],
                                                  series["seed"], series["orientation"], refs)
        path = await core.store_bytes(user["id"], img, "png", "image/png")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Storyboard failed: {e}")
    assets = [a for a in ep.get("frame_assets", [])
              if not (a.get("asset_type") == "scene_storyboard" and a.get("scene_number") == s)]
    assets.append({"asset_type": "scene_storyboard", "scene_number": s,
                   "storage_path": path, "created_at": core.now_iso()})
    ep = await ep_update(ep["id"], {"frame_assets": assets})
    return serialize_episode(series, ep)


# ---------------------------------------------------------------------------
# Pipeline: scene motion (master clip)
# ---------------------------------------------------------------------------
@router.post("/projects/{project_id}/episodes/{n}/scenes/{s}/motion")
async def start_motion(project_id: str, n: int, s: int, user: core.CurrentUser):
    series, ep = await _load_pipeline_episode(project_id, n, user)
    manifest = ep.get("manifest")
    scene = next((sc for sc in (manifest or {}).get("scenes", []) if sc["scene_number"] == s), None)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    sb = _asset(ep, "scene_storyboard", scene_number=s)
    if not sb:
        raise HTTPException(status_code=400, detail="Generate this scene's storyboard first")
    clips = list(ep.get("video_clips", []))
    existing = _master_clip(ep, s)
    if existing and existing.get("status") in ("QUEUED", "PROCESSING"):
        return {"scene_number": s, "status": existing["status"], "prediction_id": existing.get("prediction_id")}
    prompt = pipeline.build_master_motion_prompt(manifest["global_style"], scene, series["orientation"])
    try:
        started = pipeline.start_luma_motion(prompt, core.media_url(sb["storage_path"]))
    except pipeline.ProviderError as e:
        raise HTTPException(status_code=502, detail=str(e))
    clips = [c for c in clips if c["scene_number"] != s]
    clips.append({"scene_number": s, "prediction_id": started["prediction_id"], "status": started["status"],
                  "storage_path": None, "error": None, "created_at": core.now_iso(), "updated_at": core.now_iso()})
    await ep_update(ep["id"], {"video_clips": clips})
    return {"scene_number": s, "status": started["status"], "prediction_id": started["prediction_id"]}


@router.get("/projects/{project_id}/episodes/{n}/scenes/{s}/motion")
async def poll_motion(project_id: str, n: int, s: int, user: core.CurrentUser):
    series, ep = await _load_pipeline_episode(project_id, n, user)
    clip = _master_clip(ep, s)
    if not clip:
        raise HTTPException(status_code=404, detail="No render for this scene")
    if clip.get("status") == "READY" and clip.get("storage_path"):
        return {"scene_number": s, "status": "READY", "video_url": core.media_url(clip["storage_path"])}
    try:
        result = pipeline.replicate_poll(clip["prediction_id"])
    except pipeline.ProviderError as e:
        raise HTTPException(status_code=502, detail=str(e))
    changes = {"status": result["status"], "updated_at": core.now_iso()}
    video_url = None
    if result["status"] == "SUCCEEDED" and result.get("output_url"):
        try:
            data = pipeline.download_replicate_file(result["output_url"])
            path = await core.store_bytes(user["id"], data, "mp4", "video/mp4")
            changes["status"] = "READY"
            changes["storage_path"] = path
            video_url = core.media_url(path)
        except Exception as e:
            changes["status"] = "FAILED"
            changes["error"] = f"Archiving failed: {e}"
    elif result["status"] in ("FAILED", "CANCELED"):
        changes["error"] = result.get("error")
    clips = list(ep.get("video_clips", []))
    for c in clips:
        if c["scene_number"] == s:
            c.update(changes)
    await ep_update(ep["id"], {"video_clips": clips})
    out = {"scene_number": s, "status": changes["status"]}
    if video_url:
        out["video_url"] = video_url
    if changes.get("error"):
        out["error"] = changes["error"]
    return out


# ---------------------------------------------------------------------------
# Voices
# ---------------------------------------------------------------------------
_VOICE_CACHE: list[dict] = []


def _voices() -> list[dict]:
    global _VOICE_CACHE
    if not _VOICE_CACHE:
        _VOICE_CACHE = pipeline.list_voices()
    return _VOICE_CACHE


@router.get("/voices")
async def voices(user: core.CurrentUser):
    try:
        return {"voices": _voices()}
    except pipeline.ProviderError as e:
        raise HTTPException(status_code=502, detail=str(e))


def _infer_gender(profile: str) -> Optional[str]:
    t = profile.lower()
    fem = sum(t.count(w) for w in (" she ", " her ", "woman", "female", "girl", "lady", "mother", "sister", "daughter"))
    masc = sum(t.count(w) for w in (" he ", " his ", " him ", " man", "male", "boy", "father", "brother", "son"))
    if fem > masc:
        return "female"
    if masc > fem:
        return "male"
    return None


def _normalize_assignments(assignments: list, manifest: Optional[dict]) -> list:
    """One voice per character (latest updated_at wins); drop assignments whose
    character is no longer in the manifest. Mirrors the reference
    normalizeVoiceAssignments so duplicate/legacy records can never make a
    character resolve to two different voices."""
    valid = {c["id"] for c in (manifest or {}).get("characters", [])} if manifest else None
    by_char: dict = {}
    for v in assignments or []:
        cid = v.get("character_id")
        if not cid or not v.get("voice_id"):
            continue
        if valid is not None and cid not in valid:
            continue
        prev = by_char.get(cid)
        if not prev or str(v.get("updated_at", "")) >= str(prev.get("updated_at", "")):
            by_char[cid] = v
    return list(by_char.values())


def _cast_all_voices(series: dict, manifest: dict, existing: list) -> list:
    """Deterministically assign ONE distinct locked voice per character.

    The result is stable for a given series seed + character set and is
    independent of call order or concurrency, so two requests can never derive
    different voices for the same character. Any already-locked/overridden
    assignment in `existing` is preserved."""
    import random
    pool = sorted(_voices(), key=lambda v: v["voice_id"])
    buckets: dict = {"male": [], "female": [], "neutral": []}
    for v in pool:
        g = (v.get("gender") or "").lower()
        buckets["female" if g == "female" else "male" if g == "male" else "neutral"].append(v)
    rng = random.Random(series.get("seed", 0))
    for b in buckets.values():
        rng.shuffle(b)
    result = list(existing)
    locked = {a["character_id"] for a in existing}
    used = {a["voice_id"] for a in existing}
    for c in sorted(manifest["characters"], key=lambda x: x["id"]):
        if c["id"] in locked:
            continue
        gender = _infer_gender(c.get("detailed_visual_profile", "")) or "neutral"
        chosen = None
        for name in (gender, "neutral", "male", "female"):
            for v in buckets.get(name, []):
                if v["voice_id"] not in used:
                    chosen = v
                    break
            if chosen:
                break
        if not chosen:
            chosen = next((v for v in pool if v["voice_id"] not in used), pool[0] if pool else None)
        if chosen:
            used.add(chosen["voice_id"])
            result.append({"character_id": c["id"], "voice_id": chosen["voice_id"],
                           "voice_name": chosen["name"], "updated_at": core.now_iso()})
    return result


async def _ensure_voice(series: dict, ep: dict, character_id: str) -> dict:
    """Return the character's single locked voice, casting the whole episode
    deterministically if it has not been cast yet. Idempotent and race-safe:
    concurrent calls compute the same mapping, so no character can end up with
    two voices."""
    manifest = ep["manifest"]
    assignments = _normalize_assignments(ep.get("voice_assignments", []), manifest)
    found = next((v for v in assignments if v["character_id"] == character_id), None)
    if not found:
        try:
            assignments = _cast_all_voices(series, manifest, assignments)
        except pipeline.ProviderError:
            raise
        found = next((v for v in assignments if v["character_id"] == character_id), None)
    await ep_update(ep["id"], {"voice_assignments": assignments})
    ep["voice_assignments"] = assignments
    if not found:
        raise pipeline.ProviderError("No voice could be cast for this character.")
    return found


@router.post("/projects/{project_id}/episodes/{n}/voices/auto")
async def auto_assign_voices(project_id: str, n: int, user: core.CurrentUser):
    series, ep = await _load_pipeline_episode(project_id, n, user)
    manifest = ep.get("manifest")
    if not manifest:
        raise HTTPException(status_code=400, detail="Generate the script first")
    try:
        assignments = _cast_all_voices(series, manifest,
                                       _normalize_assignments(ep.get("voice_assignments", []), manifest))
    except pipeline.ProviderError as e:
        raise HTTPException(status_code=502, detail=str(e))
    ep = await ep_update(ep["id"], {"voice_assignments": assignments})
    return serialize_episode(series, ep)


@router.post("/projects/{project_id}/episodes/{n}/characters/{cid}/voice")
async def set_voice(project_id: str, n: int, cid: str, body: VoiceBody, user: core.CurrentUser):
    series, ep = await _load_pipeline_episode(project_id, n, user)
    manifest = ep.get("manifest")
    name = body.voice_name or next((v["name"] for v in _voices() if v["voice_id"] == body.voice_id), body.voice_id)
    assignments = [v for v in _normalize_assignments(ep.get("voice_assignments", []), manifest)
                   if v["character_id"] != cid]
    assignments.append({"character_id": cid, "voice_id": body.voice_id, "voice_name": name,
                        "updated_at": core.now_iso()})
    ep = await ep_update(ep["id"], {"voice_assignments": assignments})
    # Existing dialogue takes are re-synthesized with the new voice on next (re-)render.
    return serialize_episode(series, ep)


# ---------------------------------------------------------------------------
# Pipeline: dialogue shot (TTS + PixVerse lip-sync of the scene master clip)
# ---------------------------------------------------------------------------
def _find_line(manifest: dict, s: int, line_id: str):
    scene = next((sc for sc in manifest["scenes"] if sc["scene_number"] == s), None)
    if not scene:
        return None, None
    line = next((ln for ln in scene.get("dialogue_lines", []) if ln["line_id"] == line_id), None)
    return scene, line


@router.post("/projects/{project_id}/episodes/{n}/scenes/{s}/lines/{line_id}/shot")
async def start_dialogue_shot(project_id: str, n: int, s: int, line_id: str, user: core.CurrentUser):
    series, ep = await _load_pipeline_episode(project_id, n, user)
    manifest = ep.get("manifest")
    if not manifest:
        raise HTTPException(status_code=400, detail="Generate the script first")
    scene, line = _find_line(manifest, s, line_id)
    if not line:
        raise HTTPException(status_code=404, detail="Dialogue line not found")
    character = next((c for c in manifest["characters"] if c["id"] == line["character_id"]), None)
    if not character:
        raise HTTPException(status_code=404, detail="Speaking character not found")
    # The close-up source frame is the SPEAKING character's reference image so that
    # only that one character is in frame and the lip-sync animates the correct face.
    ref = _asset(ep, "character_reference", character_id=line["character_id"])
    if not ref:
        raise HTTPException(status_code=400, detail="Generate this character's image first")

    existing = _line_shot(ep, s, line_id)
    if existing and existing.get("status") in ("QUEUED", "PROCESSING"):
        return {"scene_number": s, "line_id": line_id, "status": existing["status"],
                "prediction_id": existing.get("prediction_id")}

    # 1) Ensure the line audio matches the character's CURRENT locked voice (and text).
    try:
        assignment = await _ensure_voice(series, ep, line["character_id"])
    except pipeline.ProviderError as e:
        raise HTTPException(status_code=502, detail=str(e))
    audio = _line_audio(ep, s, line_id)
    if (not audio) or audio.get("voice_id") != assignment["voice_id"] or audio.get("text") != line["text"]:
        try:
            mp3 = pipeline.synthesize_voice(assignment["voice_id"], line["text"])
            apath = await core.store_bytes(user["id"], mp3, "mp3", "audio/mpeg")
        except pipeline.ProviderError as e:
            raise HTTPException(status_code=502, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Voice synthesis failed: {e}")
        audio = {"scene_number": s, "line_id": line_id, "character_id": line["character_id"],
                 "voice_id": assignment["voice_id"], "voice_name": assignment["voice_name"],
                 "text": line["text"], "storage_path": apath, "created_at": core.now_iso()}
        audio_assets = [a for a in ep.get("audio_assets", []) if not (a["scene_number"] == s and a["line_id"] == line_id)]
        audio_assets.append(audio)
        ep = await ep_update(ep["id"], {"audio_assets": audio_assets})

    # 2) Start the per-line speaking CLOSE-UP (single character) via Luma.
    prompt = pipeline.build_dialogue_closeup_prompt(
        manifest["global_style"], scene, character, line["text"], series["orientation"])
    try:
        started = pipeline.start_luma_closeup(prompt, core.media_url(ref["storage_path"]))
    except pipeline.ProviderError as e:
        raise HTTPException(status_code=502, detail=str(e))
    closeups = [c for c in ep.get("closeup_clips", []) if not (c["scene_number"] == s and c["line_id"] == line_id)]
    closeups.append({"scene_number": s, "line_id": line_id, "character_id": line["character_id"],
                     "prediction_id": started["prediction_id"], "status": started["status"],
                     "storage_path": None, "error": None,
                     "created_at": core.now_iso(), "updated_at": core.now_iso()})
    # 3) Reset the dialogue shot record to the CLOSEUP stage (lip-sync starts once the close-up is ready).
    shots = [c for c in ep.get("lipsync_clips", []) if not (c["scene_number"] == s and c["line_id"] == line_id)]
    shots.append({"scene_number": s, "line_id": line_id, "character_id": line["character_id"],
                  "stage": "CLOSEUP", "prediction_id": None, "status": started["status"],
                  "storage_path": None, "error": None,
                  "created_at": core.now_iso(), "updated_at": core.now_iso()})
    await ep_update(ep["id"], {"closeup_clips": closeups, "lipsync_clips": shots})
    return {"scene_number": s, "line_id": line_id, "status": started["status"],
            "prediction_id": started["prediction_id"]}


def _save_closeup(ep: dict, s: int, line_id: str, changes: dict):
    clips = list(ep.get("closeup_clips", []))
    for c in clips:
        if c["scene_number"] == s and c["line_id"] == line_id:
            c.update(changes)
    return clips


def _save_shot(ep: dict, s: int, line_id: str, changes: dict):
    shots = list(ep.get("lipsync_clips", []))
    for c in shots:
        if c["scene_number"] == s and c["line_id"] == line_id:
            c.update(changes)
    return shots


@router.get("/projects/{project_id}/episodes/{n}/scenes/{s}/lines/{line_id}/shot")
async def poll_dialogue_shot(project_id: str, n: int, s: int, line_id: str, user: core.CurrentUser):
    series, ep = await _load_pipeline_episode(project_id, n, user)
    shot = _line_shot(ep, s, line_id)
    if not shot:
        raise HTTPException(status_code=404, detail="No dialogue shot for this line")
    if shot.get("status") == "READY" and shot.get("storage_path"):
        return {"scene_number": s, "line_id": line_id, "status": "READY",
                "video_url": core.media_url(shot["storage_path"])}

    stage = shot.get("stage", "LIPSYNC")

    # Stage 1: render the speaking close-up, then kick off the lip-sync.
    if stage == "CLOSEUP":
        closeup = _line_closeup(ep, s, line_id)
        if not closeup:
            raise HTTPException(status_code=404, detail="No close-up render for this line")
        if not (closeup.get("status") == "READY" and closeup.get("storage_path")):
            try:
                result = pipeline.replicate_poll(closeup["prediction_id"])
            except pipeline.ProviderError as e:
                raise HTTPException(status_code=502, detail=str(e))
            cu_changes = {"status": result["status"], "updated_at": core.now_iso()}
            if result["status"] == "SUCCEEDED" and result.get("output_url"):
                try:
                    data = pipeline.download_replicate_file(result["output_url"])
                    cpath = await core.store_bytes(user["id"], data, "mp4", "video/mp4")
                    cu_changes["status"] = "READY"
                    cu_changes["storage_path"] = cpath
                except Exception as e:
                    cu_changes["status"] = "FAILED"
                    cu_changes["error"] = f"Archiving failed: {e}"
            elif result["status"] in ("FAILED", "CANCELED"):
                cu_changes["error"] = result.get("error")
            await ep_update(ep["id"], {"closeup_clips": _save_closeup(ep, s, line_id, cu_changes)})
            ep = await core.db.episodes.find_one({"id": ep["id"]}, {"_id": 0})
            closeup = _line_closeup(ep, s, line_id)
            if closeup.get("status") in ("FAILED", "CANCELED"):
                err = closeup.get("error") or "The close-up render could not finish. You can retry this shot."
                await ep_update(ep["id"], {"lipsync_clips": _save_shot(
                    ep, s, line_id, {"status": "FAILED", "error": err, "updated_at": core.now_iso()})})
                return {"scene_number": s, "line_id": line_id, "status": "FAILED", "error": err}
        if not (closeup.get("status") == "READY" and closeup.get("storage_path")):
            return {"scene_number": s, "line_id": line_id, "status": "PROCESSING"}

        # Close-up is ready — start the PixVerse lip-sync of the close-up against the line audio.
        audio = _line_audio(ep, s, line_id)
        if not audio:
            raise HTTPException(status_code=400, detail="Voice take missing for this line")
        try:
            started = pipeline.start_pixverse_lipsync(
                core.media_url(closeup["storage_path"]), core.media_url(audio["storage_path"]))
        except pipeline.ProviderError as e:
            raise HTTPException(status_code=502, detail=str(e))
        await ep_update(ep["id"], {"lipsync_clips": _save_shot(ep, s, line_id, {
            "stage": "LIPSYNC", "prediction_id": started["prediction_id"],
            "status": started["status"] or "PROCESSING", "updated_at": core.now_iso()})})
        return {"scene_number": s, "line_id": line_id, "status": "PROCESSING"}

    # Stage 2: poll the lip-sync render and archive when ready.
    if not shot.get("prediction_id"):
        return {"scene_number": s, "line_id": line_id, "status": "PROCESSING"}
    try:
        result = pipeline.replicate_poll(shot["prediction_id"])
    except pipeline.ProviderError as e:
        raise HTTPException(status_code=502, detail=str(e))
    changes = {"status": result["status"], "updated_at": core.now_iso()}
    video_url = None
    if result["status"] == "SUCCEEDED" and result.get("output_url"):
        try:
            data = pipeline.download_replicate_file(result["output_url"])
            path = await core.store_bytes(user["id"], data, "mp4", "video/mp4")
            changes["status"] = "READY"
            changes["storage_path"] = path
            video_url = core.media_url(path)
        except Exception as e:
            changes["status"] = "FAILED"
            changes["error"] = f"Archiving failed: {e}"
    elif result["status"] in ("FAILED", "CANCELED"):
        changes["error"] = result.get("error")
    await ep_update(ep["id"], {"lipsync_clips": _save_shot(ep, s, line_id, changes)})
    out = {"scene_number": s, "line_id": line_id, "status": changes["status"]}
    if video_url:
        out["video_url"] = video_url
    if changes.get("error"):
        out["error"] = changes["error"]
    return out


# ---------------------------------------------------------------------------
# Media file serving
# ---------------------------------------------------------------------------
@router.get("/files/{path:path}")
async def serve_file(path: str, token: str = Query(None)):
    if not token or not core.verify_media_token(token, path):
        raise HTTPException(status_code=403, detail="Invalid or expired media token")
    try:
        data, content_type = await core.load_bytes(path)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(content=data, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=86400"})


# ---------------------------------------------------------------------------
# Featured
# ---------------------------------------------------------------------------
FEATURED = [
    {"id": "f1", "title": "Ward of Hearts", "genre": "Thriller", "rating": 4.8, "episodes": 45,
     "poster": "https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=400&q=70"},
    {"id": "f2", "title": "Neon Monsoon", "genre": "Romance", "rating": 4.6, "episodes": 60,
     "poster": "https://images.unsplash.com/photo-1533928298208-27ff66555d8d?w=400&q=70"},
    {"id": "f3", "title": "The Last Reel", "genre": "Drama", "rating": 4.9, "episodes": 30,
     "poster": "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=400&q=70"},
    {"id": "f4", "title": "Brides in Smoke", "genre": "Romance", "rating": 4.7, "episodes": 45,
     "poster": "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=400&q=70"},
    {"id": "f5", "title": "Mecha God", "genre": "Sci-Fi", "rating": 4.5, "episodes": 24,
     "poster": "https://images.unsplash.com/photo-1531259683007-016a7b628fc3?w=400&q=70"},
    {"id": "f6", "title": "Dark Alliance", "genre": "Thriller", "rating": 4.4, "episodes": 36,
     "poster": "https://images.unsplash.com/photo-1509347528160-9a9e33742cdb?w=400&q=70"},
]


@router.get("/featured")
async def featured():
    return {"featured": FEATURED, "trending": FEATURED[:4]}
