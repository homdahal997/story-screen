"""Zero-cost regression tests for deterministic, race-safe per-character voice
locking (iter5). No provider calls: the ElevenLabs voice pool is monkeypatched,
and no TTS / video render is ever triggered."""
import sys
import pytest

sys.path.insert(0, "/app/backend")
import routes

POOL = [
    {"voice_id": "m1", "name": "Roger", "gender": "male"},
    {"voice_id": "m2", "name": "Charlie", "gender": "male"},
    {"voice_id": "m3", "name": "Adam", "gender": "male"},
    {"voice_id": "f1", "name": "Jessica", "gender": "female"},
    {"voice_id": "f2", "name": "Ellen", "gender": "female"},
    {"voice_id": "n1", "name": "Neutral", "gender": None},
]

SERIES = {"seed": 342387}
MANIFEST = {"characters": [
    {"id": "CHARACTER_A", "name": "Lena", "detailed_visual_profile": "Female, 27, she has espresso hair, her jaw is sharp."},
    {"id": "CHARACTER_B", "name": "Adrian", "detailed_visual_profile": "Male, 40s, he wears a tailored suit, his gaze is calm."},
    {"id": "CHARACTER_C", "name": "Marcus", "detailed_visual_profile": "Male, 30s, he is sweating, his temple beading."},
]}


@pytest.fixture(autouse=True)
def _stub_pool(monkeypatch):
    monkeypatch.setattr(routes, "_voices", lambda: list(POOL))


def _cast(existing):
    return {a["character_id"]: a["voice_id"] for a in routes._cast_all_voices(SERIES, MANIFEST, existing)}


def test_deterministic_and_distinct():
    c1 = _cast([])
    c2 = _cast([])
    assert c1 == c2
    assert len(set(c1.values())) == 3


def test_gender_appropriate():
    c = _cast([])
    assert c["CHARACTER_A"] in ("f1", "f2")
    assert c["CHARACTER_B"] in ("m1", "m2", "m3")
    assert c["CHARACTER_C"] in ("m1", "m2", "m3")


def test_order_and_race_independent():
    full = _cast([])
    partial = [{"character_id": "CHARACTER_A", "voice_id": full["CHARACTER_A"],
                "voice_name": "x", "updated_at": "t0"}]
    assert _cast(partial) == full


def test_normalize_dedupes_to_one_voice_latest_wins():
    dupes = [
        {"character_id": "CHARACTER_A", "voice_id": "f2", "voice_name": "Ellen", "updated_at": "2026-09-18T01:08:00"},
        {"character_id": "CHARACTER_A", "voice_id": "f1", "voice_name": "Jessica", "updated_at": "2026-09-18T01:10:55"},
        {"character_id": "CHARACTER_B", "voice_id": "m1", "voice_name": "Roger", "updated_at": "2026-09-18T01:08:00"},
        {"character_id": "GHOST", "voice_id": "n1", "voice_name": "N", "updated_at": "2026-09-18T01:00:00"},
    ]
    norm = routes._normalize_assignments(dupes, MANIFEST)
    by = {a["character_id"]: a["voice_id"] for a in norm}
    assert by["CHARACTER_A"] == "f1"                       # latest wins
    assert len([a for a in norm if a["character_id"] == "CHARACTER_A"]) == 1
    assert "GHOST" not in by                               # non-manifest dropped
