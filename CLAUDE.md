# SMI-V Plus

HDC SMI-V report (Thai). Read only files the task names; README/CHANGELOG are long, skip unless needed.

## Layout
- `docs/` — live static site (GitHub Pages, vanilla JS, PWA). `app.js` calc engine, `ui.js` UI, `data.json` public anonymized data, `history/` import snapshots, `sw.js` service worker.
- `worker/` — Cloudflare Worker: publish to GitHub, login, private patient data (KV/R2). `index.js` handlers, `lib.mjs` helpers, `hash-password.mjs` user admin. Setup: `worker/README.md`.
- `src/` — legacy PHP/MySQL app (docker-compose, `db/*.sql`). Not the live system.
- `test/` — `node --test`: `app.test.js` engine, `ui.test.js` UI, `worker.test.mjs`, `e2e.test.mjs`.

## Commands
- Test: `npm test`
- Add/edit user: `npm run worker:hash`

## Rules
- PII: real cid + names exist only in Worker storage. `docs/data.json` and anything pushed to GitHub must stay masked (cid stripped, names masked) — masking happens in Worker, never move it client-side.
- Non-admin users scoped to one ampur; keep auth/ampur checks on every Worker endpoint.
- Changes to worker auth/data paths: run `/security-review`.
- Changing cached `docs/` assets: bump `CACHE_VERSION` in `docs/sw.js` and matching `v=` in `docs/index.html`.
- Never commit `credentials.local.txt`, `.env`.
