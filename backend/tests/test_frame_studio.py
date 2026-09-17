"""Frame Studio backend tests — auth, projects, pipeline, media, featured, video."""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL") else "https://302d42b6-c702-4373-86a0-9317c7a8e8ed.preview.emergentagent.com"

TEST_EMAIL = "test@frame.studio"
TEST_PASSWORD = "password123"

state = {}


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Health ----------
def test_health():
    r = requests.get(f"{BASE_URL}/api/health", timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True


# ---------- Auth ----------
def test_login_existing_user():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "token" in body and "user" in body
    assert body["user"]["email"] == TEST_EMAIL
    state["token"] = body["token"]
    state["user"] = body["user"]


def test_login_wrong_password():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": TEST_EMAIL, "password": "wrongpass1234"}, timeout=30)
    assert r.status_code == 401


def test_me_valid_token():
    r = requests.get(f"{BASE_URL}/api/auth/me",
                     headers=_auth_headers(state["token"]), timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["email"] == TEST_EMAIL


def test_me_invalid_token():
    r = requests.get(f"{BASE_URL}/api/auth/me",
                     headers={"Authorization": "Bearer bad.token.value"}, timeout=15)
    assert r.status_code == 401


def test_signup_new_user_and_duplicate():
    email = f"test_{uuid.uuid4().hex[:8]}@frame.studio"
    r = requests.post(f"{BASE_URL}/api/auth/signup",
                      json={"name": "Tester", "email": email, "password": "password123"},
                      timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "token" in body and body["user"]["email"] == email
    state["other_token"] = body["token"]
    state["other_email"] = email
    # duplicate
    r2 = requests.post(f"{BASE_URL}/api/auth/signup",
                       json={"name": "Tester", "email": email, "password": "password123"},
                       timeout=30)
    assert r2.status_code == 409


# ---------- Projects CRUD ----------
def test_create_project():
    payload = {"title": "TEST_Auto", "prompt": "A lonely astronaut finds a cat on Mars",
               "orientation": "vertical", "art_style": "Live-Action Film", "scene_count": 3}
    r = requests.post(f"{BASE_URL}/api/projects", json=payload,
                      headers=_auth_headers(state["token"]), timeout=30)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["id"] and p["status"] == "DRAFT" and p["scene_count"] == 3
    state["project_id"] = p["id"]


def test_list_projects_only_owner():
    r = requests.get(f"{BASE_URL}/api/projects",
                     headers=_auth_headers(state["token"]), timeout=15)
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()]
    assert state["project_id"] in ids
    # other user shouldn't see it
    r2 = requests.get(f"{BASE_URL}/api/projects",
                      headers=_auth_headers(state["other_token"]), timeout=15)
    assert r2.status_code == 200
    other_ids = [p["id"] for p in r2.json()]
    assert state["project_id"] not in other_ids


def test_cross_user_project_access_returns_404():
    r = requests.get(f"{BASE_URL}/api/projects/{state['project_id']}",
                     headers=_auth_headers(state["other_token"]), timeout=15)
    assert r.status_code == 404


# ---------- Pipeline: synopsis ----------
def test_pipeline_synopsis():
    r = requests.post(f"{BASE_URL}/api/projects/{state['project_id']}/synopsis",
                      headers=_auth_headers(state["token"]), timeout=120)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["synopsis"] and len(p["synopsis"]) > 10
    assert p["title"], "title should be populated"
    assert p["status"] == "SYNOPSIS"


# ---------- Pipeline: script ----------
def test_pipeline_script():
    r = requests.post(f"{BASE_URL}/api/projects/{state['project_id']}/script",
                      headers=_auth_headers(state["token"]), timeout=180)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["status"] == "SCRIPTED"
    assert len(p["characters"]) >= 1
    assert len(p["scenes"]) == 3
    state["character_id"] = p["characters"][0]["id"]
    state["scene_number"] = p["scenes"][0]["scene_number"]


# ---------- Pipeline: character image ----------
def test_pipeline_character_image_and_media_serving():
    cid = state["character_id"]
    r = requests.post(
        f"{BASE_URL}/api/projects/{state['project_id']}/characters/{cid}/image",
        headers=_auth_headers(state["token"]), timeout=180)
    assert r.status_code == 200, r.text
    p = r.json()
    char = next(c for c in p["characters"] if c["id"] == cid)
    url = char["image_url"]
    assert url and url.startswith("http") and "/api/files/" in url
    state["char_image_url"] = url
    # fetch
    img = requests.get(url, timeout=60)
    assert img.status_code == 200
    assert img.headers.get("Content-Type", "").startswith("image/")
    assert len(img.content) > 500


def test_media_wrong_token_forbidden():
    url = state["char_image_url"]
    # strip token
    base = url.split("?")[0]
    r = requests.get(base + "?token=bad.token", timeout=15)
    assert r.status_code == 403
    r2 = requests.get(base, timeout=15)
    # missing token -> FastAPI Query required -> 422
    assert r2.status_code in (403, 422)


# ---------- Pipeline: storyboard ----------
def test_pipeline_storyboard():
    sn = state["scene_number"]
    r = requests.post(
        f"{BASE_URL}/api/projects/{state['project_id']}/scenes/{sn}/storyboard",
        headers=_auth_headers(state["token"]), timeout=180)
    assert r.status_code == 200, r.text
    p = r.json()
    scene = next(s for s in p["scenes"] if s["scene_number"] == sn)
    assert scene["storyboard_url"] and "/api/files/" in scene["storyboard_url"]
    state["storyboard_url"] = scene["storyboard_url"]
    img = requests.get(scene["storyboard_url"], timeout=60)
    assert img.status_code == 200
    assert img.headers.get("Content-Type", "").startswith("image/")


# ---------- Featured ----------
def test_featured():
    r = requests.get(f"{BASE_URL}/api/featured", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "featured" in data and "trending" in data
    assert len(data["featured"]) >= 3


# ---------- Video: start (single scene only, per cost/time budget) ----------
def test_video_no_storyboard_returns_400():
    # Use a scene without storyboard (scene_number 2 of our project)
    r = requests.get(f"{BASE_URL}/api/projects/{state['project_id']}",
                     headers=_auth_headers(state["token"]), timeout=15)
    p = r.json()
    bare_scene = next((s for s in p["scenes"] if s["storyboard_url"] is None), None)
    assert bare_scene is not None, "expected at least one scene without storyboard"
    sn = bare_scene["scene_number"]
    r2 = requests.post(
        f"{BASE_URL}/api/projects/{state['project_id']}/scenes/{sn}/video",
        headers=_auth_headers(state["token"]), timeout=30)
    assert r2.status_code == 400, r2.text


def test_video_start_returns_queued_with_prediction_id():
    sn = state["scene_number"]
    r = requests.post(
        f"{BASE_URL}/api/projects/{state['project_id']}/scenes/{sn}/video",
        headers=_auth_headers(state["token"]), timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] in ("QUEUED", "PROCESSING", "READY", "starting")
    assert body.get("prediction_id") or body["status"] == "READY"
    state["prediction_id"] = body.get("prediction_id")


# ---------- Cleanup ----------
def test_soft_delete_project():
    r = requests.delete(f"{BASE_URL}/api/projects/{state['project_id']}",
                        headers=_auth_headers(state["token"]), timeout=15)
    assert r.status_code == 200
    r2 = requests.get(f"{BASE_URL}/api/projects/{state['project_id']}",
                      headers=_auth_headers(state["token"]), timeout=15)
    assert r2.status_code == 404
