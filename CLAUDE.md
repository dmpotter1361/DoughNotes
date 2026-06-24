# DoughNotes — notes for Claude Code

Self-hosted multi-user recipe book / tracker / journal. React client + Node/Express
API in one Docker image. Recipes are **private by default**; users publish to a
community feed. Repo `dmpotter1361/DoughNotes`.

## Stack

- **Client**: React 19 + Vite (`client/`), react-router
- **Server**: Node.js + Express 5 (`server/`), ESM
- **DB**: SQLite via better-sqlite3 (file in `DATA_DIR`, default `server/data/`)
- **Auth**: email + password, JWT in an httpOnly cookie (`server/src/auth.js`)
- **Images**: tiered. Local volume (1 MB cap) until a user links Google Drive, then
  their photos go to a `DoughNotes/` folder in their own Drive (20 MB cap) and
  existing local images migrate on link. Drive images are **proxied** through
  `GET /api/images/:id` using the owner's token (preserves the privacy model).
- **Google Drive** (`server/src/drive.js` + `routes/drive.js`): per-user OAuth
  (`drive.file` scope) via google-auth-library; tokens in `google_accounts` table.
  Recipe/collection → PDF (`server/src/pdf.js`, pdfkit) saved to Drive. Needs
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`APP_BASE_URL`; disabled gracefully if unset.
- **Port**: 3500 (a nod to 350°F)

## Run / build

```bash
# Dev (two terminals)
cd server && npm run dev      # API on :3500 (needs JWT_SECRET; see .env.example)
cd client && npm run dev      # Vite on :5173, proxies /api to :3500

# Production (single container)
cp .env.example .env          # set JWT_SECRET
docker compose up -d --build  # serves app on :3500
```

No test suite yet; verify by running the API and exercising `/api/*`.

## Layout

- `server/src/index.js` — Express entry, wires middleware + routes, serves client from `public/`
- `server/src/db.js` — SQLite connection + schema (also exports `DATA_DIR`, `UPLOADS_DIR`)
- `server/src/auth.js` — JWT sign/verify, `attachUser` / `requireAuth` / `requireAdmin`
- `server/src/routes/` — `auth`, `recipes`, `images`, `bakes`, `collections`, `admin`,
  `drive`, `import` (OCR)
- `server/src/routes/import.js` + `server/src/tessdata/eng.traineddata.gz` — photo →
  recipe OCR via tesseract.js (bundled language data; pre-fills editor, never saves)
- `client/src/pages/` — route components; `client/src/components/` — shared UI
- `client/src/api.js` — fetch wrapper; `client/src/auth.jsx` — auth context

## Conventions / invariants

- **Privacy is the core invariant**: a private recipe (and its bake log) is visible
  only to its owner — *not even to admins*. Guard every recipe read/write by
  `user_id` ownership or `is_published`.
- Admins manage **accounts**, never content.
- First registered user automatically becomes `admin`.
- Ingredients/steps are stored as JSON arrays; tags via `recipe_tags` join table.
