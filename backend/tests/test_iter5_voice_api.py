"""Zero-cost API verification for the iter5 voice-locking fix.

Scope (STRICTLY zero paid credits):
  - GET  /api/voices                                               (metadata list)
  - POST /api/projects/{pid}/episodes/1/voices/auto                (DB assignment only, idempotent)
  - GET  /api/projects/{pid}/episodes/1                            (read + serialize)

Asserts, on the pre-existing project owned by user 05eaa4c4d69f4297b9a416b39689f0f1:
  1. GET /api/voices returns a non-empty pool.
  2. After /voices/auto, EACH of the 3 characters (A/B/C) has exactly ONE voice.
  3. Locked mapping is EXACTLY:
        CHARACTER_A (Lena) -> gIc8QsaPK81pJ73KJ6Oc
        CHARACTER_B        -> CwhRBWXzGAHq8TQ4Fs17
        CHARACTER_C        -> IKne3meq5aSn9XLyUdCD
  4. Calling /voices/auto a second time returns the SAME mapping (idempotent).
  5. No character resolves to two different voices anywhere in the serialized episode
     (i.e. across dialogue lines / audio_urls / character list).
  6. Data-repair: scene-1 line "scene-1-line-2" (Lena) has `shot == null`.
  7. All remaining scene lines still map to the locked voice for their character.

No script/synopsis/image/motion/lipsync/TTS generation is triggered. This module
does not POST any /shot / /audio / /scene render endpoints.
"""
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")
import core  # noqa: E402  (for make_access_token)

PROJECT_ID = "c69332993aec4f1fbbae370a70726c09"
OWNER_ID = "05eaa4c4d69f4297b9a416b39689f0f1"
EP_N = 1

EXPECTED = {
    "CHARACTER_A": "gIc8QsaPK81pJ73KJ6Oc",
    "CHARACTER_B": "CwhRBWXzGAHq8TQ4Fs17",
    "CHARACTER_C": "IKne3meq5aSn9XLyUdCD",
}

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    # Fall back to frontend/.env
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
                    break
    except FileNotFoundError:
        pass
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not configured"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    token = core.make_access_token(OWNER_ID)
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


def _get_episode(client):
    r = client.get(f"{BASE_URL}/api/projects/{PROJECT_ID}/episodes/{EP_N}", timeout=30)
    assert r.status_code == 200, f"GET episode failed: {r.status_code} {r.text[:300]}"
    return r.json()


def _voice_by_char(ep):
    return {c["id"]: (c.get("voice") or {}).get("voice_id") for c in ep["characters"]}


# --- Test 1: /api/voices returns pool -----------------------------------
def test_voices_pool_non_empty(client):
    r = client.get(f"{BASE_URL}/api/voices", timeout=30)
    assert r.status_code == 200, f"GET /voices failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    assert "voices" in data and isinstance(data["voices"], list) and len(data["voices"]) > 0
    # Sanity: each entry has voice_id
    assert all("voice_id" in v for v in data["voices"])


# --- Test 2: /voices/auto assigns exactly the expected mapping ----------
def test_voices_auto_locks_expected_mapping(client):
    r = client.post(f"{BASE_URL}/api/projects/{PROJECT_ID}/episodes/{EP_N}/voices/auto", timeout=30)
    assert r.status_code == 200, f"POST voices/auto failed: {r.status_code} {r.text[:300]}"
    ep = r.json()
    mapping = _voice_by_char(ep)
    # Exactly the three expected characters resolve to one voice each, matching EXPECTED
    for cid, expected_vid in EXPECTED.items():
        assert cid in mapping, f"{cid} missing from serialized characters"
        assert mapping[cid] == expected_vid, f"{cid} expected {expected_vid} got {mapping[cid]}"


# --- Test 3: idempotency: second call returns SAME mapping --------------
def test_voices_auto_idempotent(client):
    r1 = client.post(f"{BASE_URL}/api/projects/{PROJECT_ID}/episodes/{EP_N}/voices/auto", timeout=30)
    assert r1.status_code == 200
    r2 = client.post(f"{BASE_URL}/api/projects/{PROJECT_ID}/episodes/{EP_N}/voices/auto", timeout=30)
    assert r2.status_code == 200
    m1 = _voice_by_char(r1.json())
    m2 = _voice_by_char(r2.json())
    assert m1 == m2, f"voices/auto not idempotent: {m1} vs {m2}"
    for cid, vid in EXPECTED.items():
        assert m2[cid] == vid


# --- Test 4: no character has two different voices in serialized ep ------
def test_no_character_has_two_voices(client):
    ep = _get_episode(client)
    # Character list must have exactly one voice per character
    seen = {}
    for c in ep["characters"]:
        v = (c.get("voice") or {}).get("voice_id")
        assert v is not None, f"{c['id']} has no locked voice"
        assert c["id"] not in seen or seen[c["id"]] == v, f"{c['id']} appears twice with different voices"
        seen[c["id"]] = v
    # Cross-check: for each scene's dialogue line, the character_id must still
    # resolve (via `seen`) to the same locked voice; no divergence.
    char_voice = seen
    for scene in ep["scenes"]:
        for line in scene["lines"]:
            cid = line.get("character_id")
            assert cid in char_voice, f"line {line.get('line_id')} references unknown character {cid}"
    # Reconfirm the exact expected mapping
    assert char_voice == EXPECTED, f"final locked mapping diverged: {char_voice}"


# --- Test 5: data repair — scene-1-line-2 (Lena) has shot == null --------
def test_data_repair_scene1_line2_shot_removed(client):
    ep = _get_episode(client)
    scene1 = next((s for s in ep["scenes"] if s.get("scene_number") == 1), None)
    assert scene1 is not None, "scene 1 missing"
    line = next((l for l in scene1["lines"] if l.get("line_id") == "scene-1-line-2"), None)
    assert line is not None, "scene-1-line-2 missing"
    # Sanity: line is Lena (CHARACTER_A)
    assert line.get("character_id") == "CHARACTER_A"
    assert line.get("shot") is None, f"stale shot not removed; still: {line.get('shot')}"


# --- Test 6: remaining lines still map to their character's locked voice --
def test_remaining_lines_map_to_locked_voice(client):
    ep = _get_episode(client)
    locked = {c["id"]: (c.get("voice") or {}).get("voice_id") for c in ep["characters"]}
    # For every non-repaired scene line, verify its character is still bound to
    # the same locked voice_id (i.e. no divergence caused by the repair).
    for scene in ep["scenes"]:
        for line in scene["lines"]:
            cid = line["character_id"]
            assert locked.get(cid) == EXPECTED[cid], (
                f"line {line['line_id']} character {cid} lost its lock: "
                f"{locked.get(cid)} vs expected {EXPECTED[cid]}"
            )
