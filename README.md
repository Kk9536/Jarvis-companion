# JARVIS Companion

- `docs/` — web app (PWA) for a private home-assistant project: signed recording tasks, 48 kHz mono PCM WAV,
  short MP4 clips, export through the share sheet. Recordings are never uploaded by the page; it is loaded from
  GitHub Pages, works offline afterwards and checks for updates when opened. The Ed25519 key in `docs/task.js` is a public key.
- `app/` — native iOS app (later, with a dedicated developer Apple ID).
