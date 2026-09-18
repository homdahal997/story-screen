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
## Iteration 3 — Fix: wrong-character lip-sync + broken re-render (verify)

### Root causes & fixes
1. **Wrong character was lip-syncing.** Previously the PixVerse lip-sync was applied to the SCENE
   MASTER motion clip, which can contain multiple characters, so the wrong face was animated.
   FIX (faithful to buildy reference `buildDialogueCloseupPrompt`): each dialogue line now first
   renders a **single-character speaking close-up** (Luma) built from the SPEAKING character's own
   reference image, and the lip-sync is applied to THAT close-up. So only the correct character is
   ever in frame. New two-stage flow per line: CLOSEUP (Luma) -> LIPSYNC (PixVerse).
   - `pipeline.build_dialogue_closeup_prompt(...)` + `pipeline.start_luma_closeup(...)`.
   - Episode doc gained a `closeup_clips` list; `routes.start_dialogue_shot` starts the close-up from
     the speaking character's `character_reference`; `routes.poll_dialogue_shot` polls the close-up,
     archives it, then starts + polls the PixVerse lip-sync of the close-up.
2. **"Re-render" did nothing.** `start_dialogue_shot` and `start_motion` short-circuited and returned
   early when status was already READY. FIX: they now only short-circuit while a render is in-flight
   (QUEUED/PROCESSING); a READY/FAILED item can be re-rendered.
3. **Voice change didn't take effect on re-render.** Audio was only synthesized once. FIX:
   `start_dialogue_shot` re-synthesizes the line audio whenever the character's current locked voice
   (or the line text) differs from the stored take, so a changed voice is applied on re-render.

### Verify (STRICT COST CONTROL — user asked not to spend credits)
- Backend only. Reuse an existing series/episode that already has script + character images.
- Confirm `start_dialogue_shot` for ONE line: returns QUEUED, creates a `closeup_clips` record whose
  source is the SPEAKING character (character_id matches the line), and a `lipsync_clips` record with
  stage=CLOSEUP. Poll drives CLOSEUP -> (PixVerse) LIPSYNC -> READY for that ONE line only.
- Confirm re-render: calling start on that line again AFTER it is READY starts a NEW render (status
  QUEUED again) rather than returning the old READY.
- Confirm re-render on a READY master motion scene also starts a new render (no READY short-circuit).
- Do NOT render more than ONE dialogue line and at most ONE extra motion re-render. No frontend E2E renders.

---
## Iteration 4 — Fix: dialogue close-up blocked by content moderation + retry (verify)

### Root cause
On the user's series (project `c69332993aec4f1fbbae370a70726c09`), scene-3 dialogue shots kept
FAILING with the generic "The render could not finish." message and Retry never recovered. Direct
inspection of the Luma predictions showed the real cause: **Luma Ray 3.2 content-moderation rejected
the close-up prompt at submit time** ("content_moderated / Prompt rejected by content policy"),
because the per-line close-up prompt embedded the scene's raw physical action ("CHARACTER_C lunges...
snatching for the file"). Retry resubmitted the same flagged prompt, so it failed every time.

### Fixes
1. `pipeline.build_dialogue_closeup_prompt` no longer includes the scene's visual_prompt/camera
   action. A talking close-up only needs the character identity + global style + the spoken line, so
   the violent scene action (which trips moderation) is dropped. VERIFIED directly: the exact
   previously-failing scene-3 close-up now passes moderation and proceeds to PROCESSING.
2. `pipeline.replicate_poll` now surfaces a content-policy-specific message when the provider flags
   the render, instead of a generic failure.
3. `pipeline.replicate_start` now retries transient gateway errors (500/502/503/504) up to 2x.

### Verify (STRICT COST CONTROL)
- Backend only, reuse project `c69332993aec4f1fbbae370a70726c09` (episode 1) owned by test@frame.studio.
- Retry line scene-3 / scene-3-line-1 via POST .../scenes/3/lines/scene-3-line-1/shot: confirm it
  starts (QUEUED/PROCESSING, new closeup_clips record, lipsync stage=CLOSEUP) and does NOT immediately
  fail with content moderation. Poll to READY for THIS ONE line only.
- Unit-verify the moderation message path: call pipeline.replicate_poll with a stubbed FAILED response
  whose error contains "content_moderated" and assert the returned error mentions the content policy
  (no real render — no cost).
- Do NOT render any other lines/scenes.


