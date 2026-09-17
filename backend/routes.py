"""All API routes for Frame Studio."""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field, field_validator

import core
import pipeline

router = APIRouter(prefix="/api")


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


class ProjectBody(BaseModel):
    title: str = Field(default="", max_length=70)
    prompt: str = Field(min_length=1, max_length=20000)
    orientation: str = "vertical"
    art_style: str = "Live-Action Film"
    scene_count: int = Field(default=4, ge=3, le=6)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def public_user(u: dict) -> dict:
    return {"id": u["id"], "name": u.get("name", ""), "email": u["email"],
            "created_at": u.get("created_at")}


async def get_owned_project(project_id: str, user: dict) -> dict:
    p = await core.db.projects.find_one(
        {"id": project_id, "owner_id": user["id"], "deleted_at": None}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def _find_asset(project: dict, asset_type: str, *, character_id: str = None,
                scene_number: int = None) -> Optional[dict]:
    for a in project.get("frame_assets", []):
        if a.get("asset_type") != asset_type:
            continue
        if character_id is not None and a.get("character_id") == character_id:
            return a
        if scene_number is not None and a.get("scene_number") == scene_number:
            return a
    return None


def serialize_project(project: dict) -> dict:
    manifest = project.get("manifest")
    characters = []
    scenes = []
    if manifest:
        for c in manifest.get("characters", []):
            asset = _find_asset(project, "character_reference", character_id=c["id"])
            characters.append({**c,
                               "image_url": core.media_url(asset["storage_path"]) if asset else None})
        clips_by_scene = {clip["scene_number"]: clip for clip in project.get("video_clips", [])}
        for s in manifest.get("scenes", []):
            sb = _find_asset(project, "scene_storyboard", scene_number=s["scene_number"])
            clip = clips_by_scene.get(s["scene_number"])
            clip_out = None
            if clip:
                clip_out = {
                    "status": clip.get("status"),
                    "prediction_id": clip.get("prediction_id"),
                    "error": clip.get("error"),
                    "video_url": core.media_url(clip["storage_path"])
                    if clip.get("storage_path") else None,
                }
            scenes.append({**s,
                           "storyboard_url": core.media_url(sb["storage_path"]) if sb else None,
                           "clip": clip_out})
    return {
        "id": project["id"],
        "title": project.get("title", ""),
        "prompt": project.get("prompt", ""),
        "orientation": project.get("orientation", "vertical"),
        "art_style": project.get("art_style", ""),
        "scene_count": project.get("scene_count", 4),
        "status": project.get("status", "DRAFT"),
        "synopsis": project.get("synopsis", ""),
        "global_style": manifest.get("global_style", "") if manifest else "",
        "characters": characters,
        "scenes": scenes,
        "created_at": project.get("created_at"),
        "updated_at": project.get("updated_at"),
    }


async def _touch(project_id: str, changes: dict) -> dict:
    changes["updated_at"] = core.now_iso()
    await core.db.projects.update_one({"id": project_id}, {"$set": changes})
    return await core.db.projects.find_one({"id": project_id}, {"_id": 0})


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@router.post("/auth/signup")
async def signup(body: SignupBody):
    email = str(body.email).strip().lower()
    existing = await core.db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Email is already registered")
    user = {
        "id": core.new_id(),
        "name": body.name.strip(),
        "email": email,
        "hashed_password": core.hash_password(body.password),
        "created_at": core.now_iso(),
    }
    await core.db.users.insert_one(user)
    token = core.make_access_token(user["id"])
    return {"token": token, "user": public_user(user)}


@router.post("/auth/login")
async def login(body: LoginBody):
    email = str(body.email).strip().lower()
    user = await core.db.users.find_one({"email": email})
    stored = user["hashed_password"] if user else core.DUMMY_HASH
    if not user or not core.verify_password(body.password, stored):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = core.make_access_token(user["id"])
    return {"token": token, "user": public_user(user)}


@router.get("/auth/me")
async def me(user: core.CurrentUser):
    return public_user(user)


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
@router.post("/projects")
async def create_project(body: ProjectBody, user: core.CurrentUser):
    project = {
        "id": core.new_id(),
        "owner_id": user["id"],
        "title": body.title.strip(),
        "prompt": body.prompt.strip(),
        "orientation": body.orientation,
        "art_style": body.art_style,
        "scene_count": body.scene_count,
        "status": "DRAFT",
        "synopsis": "",
        "manifest": None,
        "frame_assets": [],
        "video_clips": [],
        "created_at": core.now_iso(),
        "updated_at": core.now_iso(),
        "deleted_at": None,
    }
    await core.db.projects.insert_one(project)
    return serialize_project(project)


@router.get("/projects")
async def list_projects(user: core.CurrentUser):
    cursor = core.db.projects.find(
        {"owner_id": user["id"], "deleted_at": None}, {"_id": 0}).sort("created_at", -1)
    return [serialize_project(p) async for p in cursor]


@router.get("/projects/{project_id}")
async def get_project(project_id: str, user: core.CurrentUser):
    return serialize_project(await get_owned_project(project_id, user))


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, user: core.CurrentUser):
    await get_owned_project(project_id, user)
    await core.db.projects.update_one({"id": project_id},
                                      {"$set": {"deleted_at": core.now_iso()}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Pipeline: synopsis
# ---------------------------------------------------------------------------
@router.post("/projects/{project_id}/synopsis")
async def gen_synopsis(project_id: str, user: core.CurrentUser):
    p = await get_owned_project(project_id, user)
    try:
        result = await pipeline.generate_synopsis(p["prompt"], p["art_style"], p["scene_count"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Synopsis generation failed: {e}")
    title = p["title"] or result["title"]
    p = await _touch(project_id, {"title": title, "synopsis": result["synopsis"],
                                  "status": "SYNOPSIS"})
    return serialize_project(p)


# ---------------------------------------------------------------------------
# Pipeline: script / manifest
# ---------------------------------------------------------------------------
@router.post("/projects/{project_id}/script")
async def gen_script(project_id: str, user: core.CurrentUser):
    p = await get_owned_project(project_id, user)
    if not p.get("synopsis"):
        raise HTTPException(status_code=400, detail="Generate the synopsis first")
    try:
        manifest = await pipeline.generate_script(
            p["prompt"], p["title"], p["synopsis"], p["art_style"],
            p["orientation"], p["scene_count"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Script generation failed: {e}")
    p = await _touch(project_id, {"manifest": manifest, "status": "SCRIPTED",
                                  "title": p["title"] or manifest["project_title"]})
    return serialize_project(p)


# ---------------------------------------------------------------------------
# Pipeline: character image
# ---------------------------------------------------------------------------
@router.post("/projects/{project_id}/characters/{character_id}/image")
async def gen_character_image(project_id: str, character_id: str, user: core.CurrentUser):
    p = await get_owned_project(project_id, user)
    manifest = p.get("manifest")
    if not manifest:
        raise HTTPException(status_code=400, detail="Generate the script first")
    profile = next((c for c in manifest["characters"] if c["id"] == character_id), None)
    if not profile:
        raise HTTPException(status_code=404, detail="Character not found")
    try:
        img = await pipeline.generate_character_image(manifest["global_style"], profile,
                                                      p["orientation"])
        path = await core.store_bytes(user["id"], img, "png", "image/png")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Image generation failed: {e}")
    assets = [a for a in p.get("frame_assets", [])
              if not (a.get("asset_type") == "character_reference"
                      and a.get("character_id") == character_id)]
    assets.append({"asset_type": "character_reference", "character_id": character_id,
                   "storage_path": path, "created_at": core.now_iso()})
    p = await _touch(project_id, {"frame_assets": assets})
    return serialize_project(p)


# ---------------------------------------------------------------------------
# Pipeline: scene storyboard image
# ---------------------------------------------------------------------------
@router.post("/projects/{project_id}/scenes/{scene_number}/storyboard")
async def gen_storyboard(project_id: str, scene_number: int, user: core.CurrentUser):
    p = await get_owned_project(project_id, user)
    manifest = p.get("manifest")
    if not manifest:
        raise HTTPException(status_code=400, detail="Generate the script first")
    scene = next((s for s in manifest["scenes"] if s["scene_number"] == scene_number), None)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    # gather character reference images for consistency
    refs = []
    for cid in scene.get("character_focus", []):
        asset = _find_asset(p, "character_reference", character_id=cid)
        if asset:
            try:
                data, _ = await core.load_bytes(asset["storage_path"])
                refs.append(data)
            except Exception:
                pass
    try:
        img = await pipeline.generate_scene_image(manifest["global_style"], scene,
                                                  p["orientation"], refs)
        path = await core.store_bytes(user["id"], img, "png", "image/png")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Storyboard generation failed: {e}")
    assets = [a for a in p.get("frame_assets", [])
              if not (a.get("asset_type") == "scene_storyboard"
                      and a.get("scene_number") == scene_number)]
    assets.append({"asset_type": "scene_storyboard", "scene_number": scene_number,
                   "storage_path": path, "created_at": core.now_iso()})
    p = await _touch(project_id, {"frame_assets": assets})
    return serialize_project(p)


# ---------------------------------------------------------------------------
# Pipeline: scene video (start + poll)
# ---------------------------------------------------------------------------
@router.post("/projects/{project_id}/scenes/{scene_number}/video")
async def start_scene_video(project_id: str, scene_number: int, user: core.CurrentUser):
    p = await get_owned_project(project_id, user)
    manifest = p.get("manifest")
    if not manifest:
        raise HTTPException(status_code=400, detail="Generate the script first")
    scene = next((s for s in manifest["scenes"] if s["scene_number"] == scene_number), None)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    sb = _find_asset(p, "scene_storyboard", scene_number=scene_number)
    if not sb:
        raise HTTPException(status_code=400,
                            detail="Generate this scene's storyboard image first")
    clips = list(p.get("video_clips", []))
    existing = next((c for c in clips if c["scene_number"] == scene_number), None)
    if existing and existing.get("status") in ("QUEUED", "PROCESSING", "READY"):
        return {"scene_number": scene_number, "status": existing["status"],
                "prediction_id": existing.get("prediction_id")}
    prompt = pipeline.build_motion_prompt(manifest["global_style"], scene, p["orientation"])
    start_url = core.media_url(sb["storage_path"])
    try:
        started = pipeline.start_luma_prediction(prompt, start_url)
    except pipeline.ReplicateError as e:
        raise HTTPException(status_code=502, detail=str(e))
    clips = [c for c in clips if c["scene_number"] != scene_number]
    clips.append({"scene_number": scene_number, "prediction_id": started["prediction_id"],
                  "status": started["status"], "prompt": prompt, "storage_path": None,
                  "error": None, "created_at": core.now_iso(), "updated_at": core.now_iso()})
    await _touch(project_id, {"video_clips": clips})
    return {"scene_number": scene_number, "status": started["status"],
            "prediction_id": started["prediction_id"]}


@router.get("/projects/{project_id}/scenes/{scene_number}/video")
async def poll_scene_video(project_id: str, scene_number: int, user: core.CurrentUser):
    p = await get_owned_project(project_id, user)
    clips = list(p.get("video_clips", []))
    clip = next((c for c in clips if c["scene_number"] == scene_number), None)
    if not clip:
        raise HTTPException(status_code=404, detail="No render for this scene")
    if clip.get("status") == "READY" and clip.get("storage_path"):
        return {"scene_number": scene_number, "status": "READY",
                "video_url": core.media_url(clip["storage_path"])}
    try:
        result = pipeline.poll_luma_prediction(clip["prediction_id"])
    except pipeline.ReplicateError as e:
        raise HTTPException(status_code=502, detail=str(e))
    status = result["status"]
    changes = {"status": status, "updated_at": core.now_iso()}
    video_url = None
    if status == "SUCCEEDED" and result.get("output_url"):
        try:
            data = pipeline.download_video(result["output_url"])
            path = await core.store_bytes(user["id"], data, "mp4", "video/mp4")
            changes["status"] = "READY"
            changes["storage_path"] = path
            video_url = core.media_url(path)
        except Exception as e:
            changes["status"] = "FAILED"
            changes["error"] = f"Archiving the clip failed: {e}"
    elif status == "FAILED":
        changes["error"] = result.get("error")
    # persist clip update
    for c in clips:
        if c["scene_number"] == scene_number:
            c.update(changes)
    await _touch(project_id, {"video_clips": clips})
    out = {"scene_number": scene_number, "status": changes["status"]}
    if video_url:
        out["video_url"] = video_url
    if changes.get("error"):
        out["error"] = changes["error"]
    return out


# ---------------------------------------------------------------------------
# Media file serving
# ---------------------------------------------------------------------------
@router.get("/files/{path:path}")
async def serve_file(path: str, token: Optional[str] = Query(None)):
    if not token or not core.verify_media_token(token, path):
        raise HTTPException(status_code=403, detail="Invalid or expired media token")
    try:
        data, content_type = await core.load_bytes(path)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(content=data, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=86400"})


# ---------------------------------------------------------------------------
# Featured / curated content
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
