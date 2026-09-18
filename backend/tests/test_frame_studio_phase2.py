"""Frame Studio Phase 2 backend tests — Series -> Episodes contract.

Covers auth, series CRUD, episode lock guard, on-demand pipeline (synopsis/script/
character-image/storyboard), voices (list + auto assign + change), single-scene
motion start/poll, single-line lip-sync start (cost-controlled)."""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
TEST_EMAIL = "test@frame.studio"
TEST_PASSWORD = "password123"

state: dict = {}


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Auth ----------
def test_login_existing_user():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["email"] == TEST_EMAIL
    state["token"] = body["token"]
    state["user"] = body["user"]


def test_login_wrong_password():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": TEST_EMAIL, "password": "wrongpass1234"}, timeout=30)
    assert r.status_code == 401


def test_me_with_token():
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=_headers(state["token"]), timeout=15)
    assert r.status_code == 200
    assert r.json()["email"] == TEST_EMAIL


def test_signup_second_user_for_isolation():
    email = f"test_{uuid.uuid4().hex[:8]}@frame.studio"
    r = requests.post(f"{BASE_URL}/api/auth/signup",
                      json={"name": "Iso", "email": email, "password": "password123"}, timeout=30)
    assert r.status_code == 200
    state["other_token"] = r.json()["token"]


# ---------- Series CRUD ----------
def test_create_series_with_total_episodes():
    payload = {
        "title": "TEST_Phase2",
        "prompt": "A lonely astronaut finds a stray cat aboard a derelict space station.",
        "orientation": "vertical", "art_style": "Live-Action Film",
        "total_episodes": 10,
    }
    r = requests.post(f"{BASE_URL}/api/projects", json=payload,
                      headers=_headers(state["token"]), timeout=30)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["id"] and s["total_episodes"] == 10
    assert len(s["episodes"]) == 10
    # Ep1 unlocked, Ep2+ locked initially
    assert s["episodes"][0]["episode_number"] == 1
    assert s["episodes"][0]["locked"] is False
    assert s["episodes"][1]["locked"] is True
    assert s["ep1_ready"] is False
    state["project_id"] = s["id"]


def test_list_series_owner_isolation():
    r = requests.get(f"{BASE_URL}/api/projects", headers=_headers(state["token"]), timeout=15)
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()]
    assert state["project_id"] in ids
    # verify shape of episodes
    ours = next(p for p in r.json() if p["id"] == state["project_id"])
    assert ours["episodes"][0]["locked"] is False
    # other user shouldn't see it
    r2 = requests.get(f"{BASE_URL}/api/projects", headers=_headers(state["other_token"]), timeout=15)
    assert state["project_id"] not in [p["id"] for p in r2.json()]


def test_get_one_series():
    r = requests.get(f"{BASE_URL}/api/projects/{state['project_id']}",
                     headers=_headers(state["token"]), timeout=15)
    assert r.status_code == 200
    s = r.json()
    assert s["total_episodes"] == 10
    assert len(s["episodes"]) == 10
    assert s["episodes"][0]["locked"] is False and s["episodes"][9]["locked"] is True


def test_cross_user_series_returns_404():
    r = requests.get(f"{BASE_URL}/api/projects/{state['project_id']}",
                     headers=_headers(state["other_token"]), timeout=15)
    assert r.status_code == 404


# ---------- Episode lock guard ----------
def test_episode2_locked_returns_403():
    r = requests.get(f"{BASE_URL}/api/projects/{state['project_id']}/episodes/2",
                     headers=_headers(state["token"]), timeout=15)
    assert r.status_code == 403, r.text
    r2 = requests.post(f"{BASE_URL}/api/projects/{state['project_id']}/episodes/2/synopsis",
                       headers=_headers(state["token"]), timeout=15)
    assert r2.status_code == 403


def test_episode_out_of_range_returns_404():
    r = requests.get(f"{BASE_URL}/api/projects/{state['project_id']}/episodes/999",
                     headers=_headers(state["token"]), timeout=15)
    assert r.status_code == 404


# ---------- Pipeline: synopsis + script (episode 1) ----------
def test_episode1_synopsis():
    r = requests.post(f"{BASE_URL}/api/projects/{state['project_id']}/episodes/1/synopsis",
                      headers=_headers(state["token"]), timeout=120)
    assert r.status_code == 200, r.text
    ep = r.json()
    assert ep["synopsis"] and len(ep["synopsis"]) > 10
    assert ep["episode_number"] == 1
    assert ep["status"] in ("SYNOPSIS", "ASSETS", "MOTION", "VOICE", "READY")


def test_episode1_script():
    r = requests.post(f"{BASE_URL}/api/projects/{state['project_id']}/episodes/1/script",
                      headers=_headers(state["token"]), timeout=180)
    assert r.status_code == 200, r.text
    ep = r.json()
    assert len(ep["characters"]) >= 1
    assert len(ep["scenes"]) >= 1
    state["character_ids"] = [c["id"] for c in ep["characters"]]
    state["scene_numbers"] = [s["scene_number"] for s in ep["scenes"]]
    # capture a dialogue line for later
    for s in ep["scenes"]:
        if s["lines"]:
            state["dialogue_scene"] = s["scene_number"]
            state["dialogue_line_id"] = s["lines"][0]["line_id"]
            break


# ---------- BUG FIX: Character images (must return JSON, not HTML) ----------
def test_all_character_images_generate_no_html_error():
    """Reproduces & guards the reported 'Unexpected token <' bug — every character
    image endpoint must return valid JSON."""
    for cid in state["character_ids"]:
        r = requests.post(
            f"{BASE_URL}/api/projects/{state['project_id']}/episodes/1/characters/{cid}/image",
            headers=_headers(state["token"]), timeout=180,
        )
        assert r.status_code == 200, r.text
        ctype = r.headers.get("Content-Type", "")
        assert ctype.startswith("application/json"), f"non-JSON content-type: {ctype}, body: {r.text[:200]}"
        ep = r.json()  # will raise if HTML
        char = next(c for c in ep["characters"] if c["id"] == cid)
        assert char["image_url"] and "/api/files/" in char["image_url"]
    state["char_image_url"] = char["image_url"]


def test_char_image_is_actually_served():
    img = requests.get(state["char_image_url"], timeout=60)
    assert img.status_code == 200
    assert img.headers.get("Content-Type", "").startswith("image/")
    assert len(img.content) > 500


# ---------- Storyboards (all scenes) ----------
def test_all_storyboards_generate():
    for sn in state["scene_numbers"]:
        r = requests.post(
            f"{BASE_URL}/api/projects/{state['project_id']}/episodes/1/scenes/{sn}/storyboard",
            headers=_headers(state["token"]), timeout=180,
        )
        assert r.status_code == 200, r.text
        ep = r.json()
        scene = next(s for s in ep["scenes"] if s["scene_number"] == sn)
        assert scene["storyboard_url"] and "/api/files/" in scene["storyboard_url"]


# ---------- Voices ----------
def test_voices_list():
    r = requests.get(f"{BASE_URL}/api/voices", headers=_headers(state["token"]), timeout=30)
    assert r.status_code == 200
    voices = r.json()["voices"]
    assert isinstance(voices, list) and len(voices) >= 2
    assert "voice_id" in voices[0] and "name" in voices[0]
    state["alt_voice_id"] = voices[-1]["voice_id"]
    state["alt_voice_name"] = voices[-1]["name"]


def test_auto_assign_voices_distinct():
    r = requests.post(f"{BASE_URL}/api/projects/{state['project_id']}/episodes/1/voices/auto",
                      headers=_headers(state["token"]), timeout=60)
    assert r.status_code == 200, r.text
    ep = r.json()
    # Distinct voices per speaking character
    speaking = set()
    for s in ep["scenes"]:
        for ln in s["lines"]:
            speaking.add(ln["character_id"])
    voice_ids = [c["voice"]["voice_id"] for c in ep["characters"]
                 if c["id"] in speaking and c["voice"]]
    assert len(voice_ids) == len(speaking), "every speaking character must have a voice"
    assert len(set(voice_ids)) == len(voice_ids), "voices must be distinct per character"
    state["assigned_char_id"] = next(iter(speaking)) if speaking else state["character_ids"][0]


def test_change_voice():
    cid = state["assigned_char_id"]
    payload = {"voice_id": state["alt_voice_id"], "voice_name": state["alt_voice_name"]}
    r = requests.post(
        f"{BASE_URL}/api/projects/{state['project_id']}/episodes/1/characters/{cid}/voice",
        json=payload, headers=_headers(state["token"]), timeout=30,
    )
    assert r.status_code == 200, r.text
    ep = r.json()
    char = next(c for c in ep["characters"] if c["id"] == cid)
    assert char["voice"]["voice_id"] == state["alt_voice_id"]


# ---------- Motion (ONE scene only, cost-controlled) ----------
def test_motion_start_one_scene():
    sn = state["scene_numbers"][0]
    r = requests.post(
        f"{BASE_URL}/api/projects/{state['project_id']}/episodes/1/scenes/{sn}/motion",
        headers=_headers(state["token"]), timeout=60,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] in ("QUEUED", "PROCESSING", "READY", "starting")
    if body["status"] != "READY":
        assert body.get("prediction_id")
    state["motion_scene"] = sn


def test_motion_poll_once():
    sn = state["motion_scene"]
    r = requests.get(
        f"{BASE_URL}/api/projects/{state['project_id']}/episodes/1/scenes/{sn}/motion",
        headers=_headers(state["token"]), timeout=30,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in ("QUEUED", "PROCESSING", "READY", "FAILED", "starting")


def test_motion_wait_for_ready_for_lipsync():
    """Poll motion until READY (with a bounded timeout) so lip-sync can start."""
    sn = state["motion_scene"]
    deadline = time.time() + 180  # up to 3 minutes
    status = None
    while time.time() < deadline:
        r = requests.get(
            f"{BASE_URL}/api/projects/{state['project_id']}/episodes/1/scenes/{sn}/motion",
            headers=_headers(state["token"]), timeout=30,
        )
        assert r.status_code == 200
        status = r.json()["status"]
        if status in ("READY", "FAILED", "CANCELED"):
            break
        time.sleep(6)
    if status != "READY":
        pytest.skip(f"Motion not READY in time (status={status}); skipping lip-sync start.")
    state["motion_ready"] = True


# ---------- Lip-sync (ONE dialogue line only, cost-controlled) ----------
def test_lipsync_start_one_line():
    if not state.get("motion_ready"):
        pytest.skip("Skipping — motion not ready")
    if not state.get("dialogue_line_id"):
        pytest.skip("No dialogue line available")
    if state["dialogue_scene"] != state["motion_scene"]:
        pytest.skip("First dialogue is not in the motion-rendered scene; skipping to keep cost bounded")
    r = requests.post(
        f"{BASE_URL}/api/projects/{state['project_id']}/episodes/1/scenes/{state['motion_scene']}"
        f"/lines/{state['dialogue_line_id']}/shot",
        headers=_headers(state["token"]), timeout=90,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] in ("QUEUED", "PROCESSING", "READY", "starting")
    if body["status"] != "READY":
        assert body.get("prediction_id")


# ---------- Featured ----------
def test_featured_public():
    r = requests.get(f"{BASE_URL}/api/featured", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert len(body["featured"]) >= 3 and "trending" in body


# ---------- Cleanup ----------
def test_soft_delete_series():
    r = requests.delete(f"{BASE_URL}/api/projects/{state['project_id']}",
                        headers=_headers(state["token"]), timeout=15)
    assert r.status_code == 200
    r2 = requests.get(f"{BASE_URL}/api/projects/{state['project_id']}",
                      headers=_headers(state["token"]), timeout=15)
    assert r2.status_code == 404
