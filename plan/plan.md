# Frame Studio — Build Plan (Phase 1)

## Goal
Turn Frame Studio from a UI with fake data into a working app where a signed-in
creator types a story idea and the app generates a short AI drama: a title +
synopsis, a full multi-scene script, character and scene images, and a short
**silent** motion video for each scene that can be played back as a rough
preview.

## What was found (important context)
The `backend/` folder was **not** a reusable server. It was a separate web app
built on a hosted platform (superdev), where the story writing, database, image
generation, and file storage all ran on that vendor's servers, and the video
step called Replicate's **Luma Ray 3.2** model. None of it can run on its own.

So Phase 1 rebuilds that pipeline as a real backend of our own and wires the
existing Expo screens to it. The old `backend/` folder will be **deleted**.

## Decisions locked (from our conversation)
- Rebuild the backend fresh; remove the old superdev folder.
- Phase 1 scope only (below); audio/voice/lip‑sync/final export deferred.
- Video provider: **Replicate + Luma** (same model the original used).
- **No audio** in Phase 1.
- Sign‑in: **email + password**.

## What Phase 1 delivers (creator journey)
1. **Sign up / log in** with email + password. Session stays signed in on the
   device.
2. **Create a project**: enter a story premise, pick orientation
   (vertical 9:16 or horizontal 16:9), a visual style, and how many scenes
   (3–6).
3. **Synopsis step**: the app proposes a title + synopsis to approve or
   regenerate.
4. **Script step**: the app writes the full script — characters and per‑scene
   descriptions, camera direction, and dialogue — to review and approve.
5. **Assets step**: generates a reference image for each character, then a
   storyboard image for each scene that reuses those characters for a
   consistent look.
6. **Preview step**: turns each scene's storyboard into a short (~5s) silent
   motion clip via Replicate/Luma, and plays the scenes back to back as a
   rough silent preview.
7. Projects, scripts, images, and clips are saved to the creator's account and
   show up in **My List**; **Home** and **Featured** show curated/sample
   content.

Every project belongs to its owner and is private to that account.

## What you need to provide
- **A Replicate API token**, with access to the **Luma Ray 3.2** model enabled
  on that token (the model requires access to be turned on in Replicate). Video
  generation will not work without this.

Nothing else is required from you for Phase 1. Text (synopsis/script), the
character/scene images, and file storage will use Emergent‑managed AI and
storage (no extra keys), with strong default models chosen for quality and
character consistency.

## Expectations worth knowing (please confirm you're OK with these)
- **Video is slow and costs money.** Each scene is a separate Luma render that
  typically takes a couple of minutes and consumes Replicate credits. A 4‑scene
  drama means ~4 renders. The app shows progress and keeps working while they
  run; finished clips are saved so they aren't re‑generated.
- **Preview is silent and per‑scene, hard‑cut** (no music, no voices, no
  transitions). Sound and a single stitched export come in Phase 2.
- **Projects live in your account on the server** (durable, available across
  devices). The app stores only your login session on the device. This differs
  slightly from the original note about keeping projects only in local phone
  storage, but it's needed for real accounts and reliable saves.
- Scene motion clips are generated from the **storyboard image** of each scene,
  so image quality drives video quality.

## Deferred to Phase 2 (not in this build)
- ElevenLabs character voices and ambient sound beds.
- Dialogue close‑up shots and lip‑sync (Sync / PixVerse).
- A single stitched, exportable/downloadable final episode with audio.
- Advanced multi‑shot planning and assembly from the original app.

## Assumptions (tell me if any are wrong)
- Email + password accounts, no email verification or password reset in Phase 1
  (basic "forgot password" screen stays visual only for now).
- 3–6 scenes per project; each scene clip is a fixed ~5 seconds.
- The design system and colors stay exactly as defined; no visual redesign.
- Home/Featured show sample/curated dramas (not other users' private work).

## How you'll know it works
You'll be able to sign up, create a project from a prompt, approve the synopsis
and script, watch character + scene images appear, generate the per‑scene
silent clips, and play the rough preview — then find the saved project in My
List after closing and reopening the app.
