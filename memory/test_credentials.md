# Frame Studio — Test Credentials

## Test creator account (email + password auth)
- Email: `test@frame.studio`
- Password: `password123`

Notes:
- Auth is JWT (email + password). Signup endpoint: `POST /api/auth/login` / `POST /api/auth/signup`.
- New accounts can be created via the signup screen (name + email + password, 8+ chars).
- Session token is stored on-device (SecureStore native / localStorage web) and restored on relaunch.

## Backend integrations (all configured)
- Emergent LLM key: configured in backend/.env (text synopsis/script + Gemini Nano Banana images).
- Emergent Object Storage: configured (stores character images, storyboards, video clips).
- Replicate (Luma Ray 3.2): configured. Video render for one scene takes ~1-2 min and consumes credits.

## Existing sample project with a fully rendered scene
- A project owned by `test@frame.studio` already has scene 1 with a READY video clip (for playback checks).
