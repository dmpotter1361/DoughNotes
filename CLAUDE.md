# DoughNotes — notes for Claude Code

Self-hosted baking recipe book/tracker/journal. Browser client, Node.js/Express backend, single Docker image. Repo `dmpotter1361/DoughNotes`.

## Stack

- **Client**: React 19 + Vite (in `client/`)
- **Server**: Node.js + Express 5 (in `server/`)
- **Deploy**: Single Docker image (multi-stage build) via `docker compose up`
- **Image storage**: TBD — to be decided in planning

## Run / build

```bash
# Dev (run in separate terminals)
cd server && npm run dev   # port 3000
cd client && npm run dev   # port 5173, proxies /api to server

# Production
docker compose up -d
```

## Layout

- `client/` — React frontend (Vite)
- `server/src/index.js` — Express entry point
- `Dockerfile` — multi-stage build (builds client, serves from Express)
- `docker-compose.yml` — single-service compose file
