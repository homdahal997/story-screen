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

## Notes
- Video is slow (~1-2 min/scene) and consumes Replicate credits; clips are archived for reuse.
- Replicate token + Emergent keys live only in backend/.env.
