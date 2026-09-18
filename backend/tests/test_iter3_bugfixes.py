"""Iteration-3 targeted regression tests for the two reported bugs:

1. WRONG-CHARACTER LIP-SYNC (FIX 1): the per-line dialogue shot must render a
   single-character speaking close-up from the SPEAKING character's own reference
   image, then lip-sync that close-up. Verify the closeup_clips record carries the
   speaking character's character_id and the lipsync_clips record starts at
   stage=CLOSEUP.
2. RE-RENDER NOT WORKING (FIX 2 + FIX 2b): starting a shot on a line that is
   already READY must kick off a NEW render (not short-circuit), and same for a
   master motion clip already READY.
3. VOICE CHANGE ON RE-RENDER (FIX 3): after changing a character's voice, the next
   dialogue-shot start must re-synthesize the line audio with the new voice_id.

STRICT COST CONTROL: at most 1 full dialogue close-up->lipsync polled to READY,
1 extra dialogue-shot start (not polled), and 1 motion re-render start (not polled).
Reuses an existing series/episode that already has script + character images +
storyboards + a READY master motion.
"""
from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional

import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

# Load backend .env for direct DB inspection (allowed by spec: "You may inspect the DB").
load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
TEST_EMAIL = "test@frame.studio"
TEST_PASSWORD = "password123"

# Existing series (owned by test@frame.studio) with:
#   - 3 character images (CHARACTER_A/B/C)
#   - all 5 scene storyboards
#   - scene 1 master motion READY
#   - voice assignments for all 3 characters
#   - existing audio take for scene-1-line-1 (voice=Bill / pqHfZKP75CvOlQylNhV4)
PROJECT_ID = "8e3af3cb50604f03a3911154b80d166b"
EP_NUMBER = 1
SCENE_NUMBER = 1
LINE_ID = "scene-1-line-1"
LINE_CHARACTER_ID = "CHARACTER_A"

state: Dict[str, Any] = {}


# -------------------- helpers --------------------
def _headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _db():
    client = MongoClient(os.environ["MONGO_URL"])
    return client[os.environ["DB_NAME"]]


def _episode_doc() -> Dict[str, Any]:
    doc = _db().episodes.find_one(
        {"project_id": PROJECT_ID, "episode_number": EP_NUMBER}, {"_id": 0}
    )
    assert doc, "seed episode missing"
    return doc


def _closeup_for(ep: Dict[str, Any], s: int, line_id: str) -> Optional[Dict[str, Any]]:
    for c in ep.get("closeup_clips") or []:
        if c.get("scene_number") == s and c.get("line_id") == line_id:
            return c
    return None


def _lipsync_for(ep: Dict[str, Any], s: int, line_id: str) -> Optional[Dict[str, Any]]:
    for c in ep.get("lipsync_clips") or []:
        if c.get("scene_number") == s and c.get("line_id") == line_id:
            return c
    return None


def _audio_for(ep: Dict[str, Any], s: int, line_id: str) -> Optional[Dict[str, Any]]:
    for a in ep.get("audio_assets") or []:
        if a.get("scene_number") == s and a.get("line_id") == line_id:
            return a
    return None


def _master_for(ep: Dict[str, Any], s: int) -> Optional[Dict[str, Any]]:
    for v in ep.get("video_clips") or []:
        if v.get("scene_number") == s:
            return v
    return None


# -------------------- 0. auth + seed sanity --------------------
def test_login_and_seed_sanity():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    state["token"] = r.json()["token"]

    # Seed sanity: the reused episode must have what the shot flow needs.
    ep = _episode_doc()
    assert ep.get("manifest"), "seed episode missing manifest"
    frame_assets = ep.get("frame_assets") or []
    char_imgs = {a["character_id"] for a in frame_assets
                 if a.get("asset_type") == "character_reference"}
    assert LINE_CHARACTER_ID in char_imgs, "speaking character's reference image missing"
    scenes = ep["manifest"]["scenes"]
    scene = next(s for s in scenes if s["scene_number"] == SCENE_NUMBER)
    line = next(l for l in scene.get("dialogue_lines", []) if l["line_id"] == LINE_ID)
    assert line["character_id"] == LINE_CHARACTER_ID, "seed line not spoken by expected character"
    master = _master_for(ep, SCENE_NUMBER)
    assert master and master.get("status") == "READY", "seed motion must be READY for FIX 2b"
    state["initial_master_prediction_id"] = master["prediction_id"]
    # capture audio-take voice before we do anything
    audio = _audio_for(ep, SCENE_NUMBER, LINE_ID)
    state["initial_audio_voice_id"] = audio["voice_id"] if audio else None


# -------------------- FIX 1: correct-character close-up + lip-sync --------------------
def test_fix1_start_dialogue_shot_uses_speaking_character_closeup():
    """POST /shot for scene 1 line 1 must:
       (a) return QUEUED/PROCESSING with a prediction_id,
       (b) create a closeup_clips record whose character_id == LINE speaker,
       (c) create a lipsync_clips record with stage='CLOSEUP'.
    """
    url = (f"{BASE_URL}/api/projects/{PROJECT_ID}/episodes/{EP_NUMBER}"
           f"/scenes/{SCENE_NUMBER}/lines/{LINE_ID}/shot")
    r = requests.post(url, headers=_headers(state["token"]), timeout=120)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] in ("QUEUED", "PROCESSING", "starting"), body
    assert body.get("prediction_id"), "prediction_id missing on start"
    state["first_prediction_id"] = body["prediction_id"]

    ep = _episode_doc()
    cu = _closeup_for(ep, SCENE_NUMBER, LINE_ID)
    assert cu is not None, "closeup_clips record was not created"
    assert cu["character_id"] == LINE_CHARACTER_ID, (
        f"close-up character_id={cu['character_id']} does not match line speaker "
        f"{LINE_CHARACTER_ID} — WRONG CHARACTER BUG NOT FIXED")
    assert cu["prediction_id"] == body["prediction_id"]
    assert cu["status"] in ("QUEUED", "PROCESSING", "starting")

    ls = _lipsync_for(ep, SCENE_NUMBER, LINE_ID)
    assert ls is not None, "lipsync_clips record was not created"
    assert ls.get("stage") == "CLOSEUP", (
        f"lipsync_clips.stage should start at CLOSEUP, got {ls.get('stage')!r}")
    assert ls["character_id"] == LINE_CHARACTER_ID


def test_fix1_poll_shot_to_ready():
    """Poll GET /shot for the same line until READY (CLOSEUP -> LIPSYNC -> READY).
    Cost note: this is the ONE full render we're allowed to poll to completion."""
    url = (f"{BASE_URL}/api/projects/{PROJECT_ID}/episodes/{EP_NUMBER}"
           f"/scenes/{SCENE_NUMBER}/lines/{LINE_ID}/shot")
    deadline = time.time() + 8 * 60  # up to 8 minutes total (close-up ~1min + lip-sync ~1-3min)
    seen_stages = set()
    last_body: Dict[str, Any] = {}
    while time.time() < deadline:
        r = requests.get(url, headers=_headers(state["token"]), timeout=60)
        assert r.status_code == 200, r.text
        last_body = r.json()
        ep = _episode_doc()
        ls = _lipsync_for(ep, SCENE_NUMBER, LINE_ID)
        if ls and ls.get("stage"):
            seen_stages.add(ls["stage"])
        status = last_body.get("status")
        if status in ("READY", "FAILED", "CANCELED"):
            break
        time.sleep(8)

    assert last_body.get("status") == "READY", (
        f"shot did not reach READY in time; last body={last_body}")
    assert last_body.get("video_url"), "READY shot must expose video_url"
    # We should have gone through the CLOSEUP stage and then the LIPSYNC stage.
    assert "CLOSEUP" in seen_stages, f"never observed CLOSEUP stage; seen={seen_stages}"
    assert "LIPSYNC" in seen_stages, f"never observed LIPSYNC stage; seen={seen_stages}"


# -------------------- FIX 3: change voice, so FIX-2 re-render also re-synthesizes audio --------------------
def test_fix3_change_character_voice():
    r = requests.get(f"{BASE_URL}/api/voices", headers=_headers(state["token"]), timeout=30)
    assert r.status_code == 200, r.text
    voices = r.json()["voices"]
    current = state["initial_audio_voice_id"]
    alt = next(v for v in voices if v["voice_id"] != current)
    state["new_voice_id"] = alt["voice_id"]
    state["new_voice_name"] = alt["name"]

    r = requests.post(
        f"{BASE_URL}/api/projects/{PROJECT_ID}/episodes/{EP_NUMBER}/characters/{LINE_CHARACTER_ID}/voice",
        json={"voice_id": alt["voice_id"], "voice_name": alt["name"]},
        headers=_headers(state["token"]), timeout=30,
    )
    assert r.status_code == 200, r.text
    ep_payload = r.json()
    char = next(c for c in ep_payload["characters"] if c["id"] == LINE_CHARACTER_ID)
    assert char["voice"]["voice_id"] == alt["voice_id"], "voice assignment did not update"


# -------------------- FIX 2 + FIX 3 re-render: same line, expect NEW render + fresh audio --------------------
def test_fix2_re_render_starts_new_render_and_fix3_applies_new_voice():
    """POST the same line's /shot AGAIN after it reached READY. Must NOT return
    the old READY — must start a fresh render (QUEUED/PROCESSING + new prediction_id
    + new closeup_clips record). Also confirms the audio was re-synthesized with
    the newly assigned voice (FIX 3)."""
    url = (f"{BASE_URL}/api/projects/{PROJECT_ID}/episodes/{EP_NUMBER}"
           f"/scenes/{SCENE_NUMBER}/lines/{LINE_ID}/shot")
    # Pre-condition: line is currently READY (from previous test).
    r = requests.post(url, headers=_headers(state["token"]), timeout=120)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] in ("QUEUED", "PROCESSING", "starting"), (
        f"re-render short-circuited to {body!r} — RE-RENDER BUG NOT FIXED")
    assert body.get("prediction_id"), "re-render must return a new prediction_id"
    assert "video_url" not in body, (
        "re-render must NOT surface the old READY video_url on start")
    new_pred = body["prediction_id"]
    assert new_pred != state.get("first_prediction_id"), (
        "re-render must produce a NEW Luma prediction id, got same as first")

    # DB proof: a fresh closeup_clips record now exists with the new prediction id,
    # its character_id still matches the speaker (regression guard on FIX 1).
    ep = _episode_doc()
    cu = _closeup_for(ep, SCENE_NUMBER, LINE_ID)
    assert cu is not None
    assert cu["prediction_id"] == new_pred
    assert cu["status"] in ("QUEUED", "PROCESSING", "starting")
    assert cu["character_id"] == LINE_CHARACTER_ID

    # And the lipsync_clips record is reset back to stage=CLOSEUP for the new render.
    ls = _lipsync_for(ep, SCENE_NUMBER, LINE_ID)
    assert ls is not None
    assert ls.get("stage") == "CLOSEUP", (
        f"lipsync stage should reset to CLOSEUP on re-render, got {ls.get('stage')!r}")
    assert ls.get("status") in ("QUEUED", "PROCESSING", "starting")

    # FIX 3 proof: audio_assets voice_id now equals the newly-assigned voice.
    audio = _audio_for(ep, SCENE_NUMBER, LINE_ID)
    assert audio is not None, "audio take missing after re-render"
    assert audio["voice_id"] == state["new_voice_id"], (
        f"audio_assets voice_id={audio['voice_id']} did not update to newly-assigned "
        f"voice {state['new_voice_id']} — VOICE-CHANGE-ON-RE-RENDER BUG NOT FIXED")
    assert audio["voice_id"] != state["initial_audio_voice_id"]


# -------------------- FIX 2b: motion re-render also does not short-circuit --------------------
def test_fix2b_motion_re_render_starts_new_render():
    """POST /motion for a scene whose master motion is already READY. Must start a
    NEW render (not return the READY short-circuit)."""
    url = (f"{BASE_URL}/api/projects/{PROJECT_ID}/episodes/{EP_NUMBER}"
           f"/scenes/{SCENE_NUMBER}/motion")
    r = requests.post(url, headers=_headers(state["token"]), timeout=120)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] in ("QUEUED", "PROCESSING", "starting"), (
        f"motion re-render short-circuited to {body!r} — MOTION RE-RENDER BUG NOT FIXED")
    assert body.get("prediction_id"), "motion re-render must return a new prediction_id"
    assert body["prediction_id"] != state.get("initial_master_prediction_id"), (
        "motion re-render must produce a NEW Luma prediction id")
    # DB proof: video_clips[scene=1] now has the new prediction id (status not READY yet).
    ep = _episode_doc()
    master = _master_for(ep, SCENE_NUMBER)
    assert master is not None
    assert master["prediction_id"] == body["prediction_id"]
    assert master["status"] in ("QUEUED", "PROCESSING", "starting")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
