# Frame Studio — Test Result & Protocol

## Current phase: Phase 2 (Series → Episodes + Voice + Lip-sync)

### What changed in this iteration
- Backend was rewritten for a Series → Episodes model with the full reference pipeline:
  synopsis → script → character images → storyboards → motion (Luma) → voice (ElevenLabs, locked
  per character) → lip-sync (PixVerse). Backend was already running/healthy.
- Frontend was fully rewired to the Phase 2 API contract (was previously broken on Phase 1 routes):
  - `src/services/api.ts` — Series/Episode types + all `/projects/{id}/episodes/{n}/...` endpoints,
    plus hardened `request()` that throws a clean error on non-JSON (proxy/HTML) responses.
  - `src/components/CreateWorkSheet.tsx` — "Total Episodes" (10 / 45 / 60 / Custom) instead of scenes.
  - `app/(tabs)/mylist.tsx` — lists Series.
  - `app/project/[id].tsx` — Series detail with Episode list (Ep 1 unlocked, Ep 2+ locked).
  - `app/create/pipeline.tsx` — per-episode 8-step stepper wizard with ON-DEMAND generate buttons
    (Synopsis, Script, Assets, Story, Motion, Voice, Lip-sync, Preview).

### Reported bug being fixed (must verify)
- User saw: `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` on character generation.
- Root cause: the old frontend called Phase 1 routes that no longer exist; the fix is the full
  Phase 2 rewire above + hardened JSON parsing. Verify character image generation now works end to
  end with NO JSON/HTML parse error.

## Test credentials
- Email: `test@frame.studio`  Password: `password123`
- Backend base: use `EXPO_PUBLIC_BACKEND_URL` (frontend/.env). API prefix `/api`.

## COST CONTROL (mandatory)
- Video (Luma) and lip-sync (PixVerse) consume real credits and take 1-2 min each.
- Text + image steps (synopsis, script, character images, storyboards) are cheap — test fully.
- Motion: start + poll for AT MOST ONE scene. Lip-sync: start for AT MOST ONE dialogue line.
- Do NOT loop renders across all scenes/lines.

## Key Phase 2 endpoints
- POST /api/projects  { title, prompt, orientation, art_style, total_episodes } -> Series
- GET  /api/projects ; GET /api/projects/{id} ; DELETE /api/projects/{id}
- GET  /api/projects/{id}/episodes/{n}  (403 if episode>1 and Ep1 not ready)
- POST .../episodes/{n}/synopsis ; .../script
- POST .../episodes/{n}/characters/{cid}/image ; .../scenes/{s}/storyboard
- POST/GET .../episodes/{n}/scenes/{s}/motion
- GET  /api/voices ; POST .../episodes/{n}/voices/auto ; POST .../characters/{cid}/voice
- POST/GET .../episodes/{n}/scenes/{s}/lines/{line_id}/shot

## Incorporate testing protocol
- Read this file before testing. Do not re-run the full Phase 1 pytest.
- Backend agent: verify Phase 2 endpoints + episode lock guard + cost-controlled renders.
- Frontend agent: verify login → create series → Ep1 stepper (esp. character image gen, the bug) →
  Next-button gating → series detail episode locks.

---
(Testing agent appends structured results to /app/test_reports/iteration_{n}.json)
