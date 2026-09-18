# Frame Studio — PRD & Build Log

## Original Problem Statement
Frame Studio is a React Native (Expo SDK 54) mobile app for creating AI-generated short drama
series (Epnova-style). A creator enters a story idea and the app runs a 5-step pipeline —
Synopsis → Script → Asset → Storyboard → Preview — to produce a multi-scene silent AI drama.
The original `/backend` was a superdev web app (not reusable); Phase 1 rebuilds it as a real
FastAPI backend and wires the existing Expo screens to it.

## Architecture (post Phase 1)
- **Frontend**: Expo SDK 54 + expo-router at `/app/frontend`. React Query for server state,
  SecureStore/localStorage for the session token. Locked design system (`src/design-system/tokens.ts`).
- **Backend**: FastAPI + MongoDB (motor) at `/app/backend`
  - `server.py` app/CORS/startup, `core.py` (settings, Mongo, JWT auth, object storage, media tokens),
    `pipeline.py` (LLM text + Gemini image + Replicate Luma video), `routes.py` (all `/api` routes).
- **Integrations**: JWT email+password auth; Emergent LLM key (gpt-5.4 text, Gemini Nano Banana
  images); Emergent Object Storage (images + mp4 clips); Replicate Luma Ray 3.2 (image→video).
- **Media**: files stored in object storage; served via `GET /api/files/{path}?token=<media-jwt>`
  (public-reachable so Replicate can fetch start images and the app/web can display).

## User Persona
- **Creator**: types a premise, approves AI title/synopsis/script, generates character & scene
  images, renders per-scene silent clips, and plays a rough preview. Projects are private per account.

## Core Requirements (static)
1. Email+password accounts; session persists on device.
2. Create project (premise, orientation 9:16/16:9, art style, 3–6 scenes).
3. 5-step pipeline with approve/regenerate at each stage.
4. Character reference images reused for scene storyboards (consistency).
5. Per-scene ~5s silent Luma clip; back-to-back silent preview.
6. Projects/scripts/images/clips saved to the account; My List; curated Home/Featured.

## Implemented (2026-09-17)
- ✅ Restructured repo to Emergent layout (Expo→/app/frontend, FastAPI→/app/backend); removed old superdev folder.
- ✅ JWT auth (signup/login/me), session persistence, auth-gated navigation.
- ✅ Projects CRUD (create/list/get/soft-delete) with per-owner isolation.
- ✅ Synopsis + Script generation (gpt-5.4) → structured manifest (characters + scenes).
- ✅ Character reference images + scene storyboards (Gemini Nano Banana, multi-image reference).
- ✅ Per-scene video render via Replicate Luma Ray 3.2 (duration=5) → archived to object storage → served.
- ✅ Silent sequential preview player (expo-video), My List, Project detail, Home/Featured (live API).
- ✅ 18/18 backend tests pass; frontend critical flows verified.

## Backlog / Next (P1/P2)
- **P1**: Edit synopsis/script/scene text inline; regenerate a single scene image without losing others;
  progress persistence badge on Home ("resume rendering").
- **P1**: Render-all queue with progress across scenes.
- **P2 (deferred per plan)**: ElevenLabs character voices + ambient beds; dialogue close-ups/lip-sync;
  single stitched exportable episode with audio; advanced multi-shot planning.
- **P2**: Real forgot-password flow (currently visual only).

## Phase 2 (2026-09-18) — Series → Episodes + Voice + Lip-sync
Reworked from single "project + scenes" into **Series → Episodes**. Each series has a premise,
orientation, art style and a total episode count. Episode 1 is unlocked; Episodes 2+ stay locked
until Episode 1 is fully generated (guarded server-side, 403). Every episode runs the full reference
pipeline on demand (per-stage buttons, to control credit spend):
Synopsis → Script → Character images → Storyboards → Motion (Luma Ray 3.2) →
Voice (ElevenLabs, a distinct locked voice auto-cast per speaking character, changeable) →
Lip-sync (PixVerse, per dialogue line against the scene's master motion clip) → Preview.

- **Backend** (`core.py`, `pipeline.py`, `routes.py`): `projects` collection stores series;
  `episodes` collection stores per-episode manifest, frame_assets, video_clips, voice_assignments,
  audio_assets, lipsync_clips. Voices auto-assigned with smart gender casting from the character
  profile. ElevenLabs `eleven_multilingual_v2`; PixVerse + Luma via Replicate predictions API.
- **Frontend**: `api.ts` (Series/Episode types + episode endpoints, hardened non-JSON handling),
  `CreateWorkSheet` (Total Episodes 10/45/60/Custom), `mylist` (series list), `project/[id]`
  (series detail + episode locks), `create/pipeline` (8-step per-episode stepper wizard, on-demand).
- **Bug fixed**: frontend was calling old Phase 1 routes -> `Unexpected token '<' ... <!DOCTYPE`
  on character generation. Fixed by the full Phase 2 rewire + graceful non-JSON error in `request()`.

## Fix (2026-09-18c) — Dialogue shots blocked by content moderation; Retry now works
- **Symptom:** dialogue "voicing" shots FAILED with "The render could not finish." and Retry never
  recovered. **Root cause:** Luma Ray 3.2 content-moderation rejected the per-line close-up prompt at
  submit time because it embedded the scene's violent action ("lunges/snatching for the file");
  Retry resubmitted the same flagged prompt each time.
- **Fixes** (`pipeline.py`): (1) the close-up prompt now uses only character identity + global style +
  the spoken line (scene action/camera dropped), so it passes moderation; (2) `replicate_poll`
  surfaces a content-policy-specific message; (3) `replicate_start` retries transient 5xx gateway
  errors. Verified backend-only (8/8), incl. the user's exact previously-failing line now retrying to
  READY. Known follow-up: orphaned storage paths on re-render aren't cleaned up yet.

## Fix (2026-09-18b) — Correct-character lip-sync + working re-render
- **Wrong character lip-syncing** fixed: lip-sync was applied to the multi-character scene master, so
  PixVerse animated the wrong face. Now, faithful to buildy, each dialogue line renders a
  single-character **speaking close-up** (Luma) from the SPEAKING character's own reference image, and
  the lip-sync is applied to that close-up. Two-stage per line: CLOSEUP (Luma) → LIPSYNC (PixVerse),
  orchestrated inside the poll endpoint. Episode doc gained `closeup_clips`.
- **Re-render** fixed for both dialogue shots and scene motion: they no longer short-circuit when
  already READY (only skip while a render is in-flight).
- **Voice change** now applies on re-render: line audio is re-synthesized when the character's current
  locked voice (or line text) differs from the stored take.
- Verified backend-only, cost-controlled (1 close-up+lip-sync to READY, 1 re-render start, 1 motion
  re-render start): 6/6 regression tests pass (`backend/tests/test_iter3_bugfixes.py`).

## Backlog / Next (Phase 2 follow-up)
- Server-side stitching of an episode's shots into one downloadable/playable video with audio.

## Notes
- Video (Luma) and lip-sync (PixVerse) are slow (~1-2 min each) and consume Replicate credits;
  every generated clip is archived to object storage for reuse. Generation is strictly on-demand.
- Replicate + ElevenLabs + Emergent keys live only in backend/.env.
