# DoughNotes

A self-hosted recipe book, tracker, and journal. Save your recipes, keep a private
bake log, publish your best ones to the community, and run the whole thing yourself
in a single Docker container.

> Personal project. Spin it up, make it yours. 🥐

## Features

- **Your recipe collection** — rich editor (title, description, prep/cook times,
  servings, ingredients, steps), tags, and collections
- **Private by default** — every recipe stays private until *you* publish it
- **Community feed** — browse and search recipes other people have published
- **Private bake log** — a "My Bakes" tab on each recipe to log attempts, dates,
  notes, and how they turned out (only you ever see it)
- **Photos** — attach images (1 MB each on local storage; connect Google Drive for
  unlimited storage + recipe-book PDF export — *coming soon*)
- **Accounts & roles** — email/password login; the first account is the admin and
  manages users (admins manage *accounts*, never your private recipes)
- **Import from a photo** — snap a handwritten or printed recipe card; on-device
  OCR (tesseract.js) reads it and pre-fills the editor for you to tidy up
- **Print-friendly** — clean print/PDF view of any recipe

## Run it on your server (from GitHub)

Prerequisites: a machine with [Docker](https://docs.docker.com/get-docker/) and
[Git](https://git-scm.com/) (Docker Compose ships with Docker today).

> The `docker` commands below use `sudo`, which is needed on most Linux servers.
> If you've added your user to the `docker` group, you can drop the `sudo`.

```bash
# 1. Get the code
git clone https://github.com/dmpotter1361/DoughNotes.git
cd DoughNotes

# 2. Create your .env (sets the session secret)
cp .env.example .env
#   then edit .env and set JWT_SECRET to a long random string, e.g.:
#   openssl rand -hex 32

# 3. Start it — the launcher checks your setup, picks profiles, and health-checks
./start.sh
```

`start.sh` is the easiest way to run DoughNotes: it generates a `JWT_SECRET` if missing,
picks HTTP vs HTTPS and AI on/off (from your `.env`, flags, or a quick prompt), starts the
right containers, waits for the app to be healthy, and pulls the AI model if needed.

```bash
./start.sh                 # interactive: confirms mode + AI
./start.sh --https --ai    # HTTPS (Caddy) + local AI (Ollama), non-interactively
./start.sh --http --no-ai  # plain HTTP on :3500, heuristic imports
./start.sh --help          # all options
```

Companion scripts:

```bash
./update.sh [flags]   # git pull, then rebuild + restart (passes flags to start.sh)
./stop.sh             # stop the app (keeps all your data)
```

Prefer to drive Compose yourself? That works too:

```bash
sudo docker compose up -d --build
```

Open **http://<your-server>:3500** and register — the **first account becomes the
admin**. (Port 3500 is a nod to 350°F. 🔥)

### HTTPS with a domain (recommended)

If you have a domain pointed at the server, run it behind the built-in **Caddy**
reverse proxy for automatic HTTPS (Let's Encrypt). In `.env` set:

```bash
DOMAIN=doughnotes.myhomegames.net
APP_BASE_URL=https://doughnotes.myhomegames.net
COOKIE_SECURE=true
```

Forward router ports **80 and 443** to the server, then start with the `https` profile:

```bash
sudo docker compose --profile https up -d --build
```

Caddy fetches a certificate automatically and serves the app at
`https://<your-domain>`. (Google Drive sign-in also **requires** HTTPS on a real
domain — plain `http://` only works on `localhost`.)

> **Plain HTTP note:** without the `https` profile the app runs over plain HTTP on
> port 3500 — fine for quick testing, but keep `COOKIE_SECURE=false` for that, and
> don't expose it long-term (passwords travel unencrypted).

### Optional: private AI recipe import

Recipe imports (photos, PDFs, pasted text) use a built-in heuristic parser by default.
For much better results on messy sources — phone screenshots of social-media posts, etc. —
you can run a small **local AI model** via the bundled **Ollama** service. It's fully
private (nothing leaves your server) and entirely optional; if it's off or unavailable,
imports automatically fall back to the heuristic.

```bash
# 1. In .env:
#      OLLAMA_URL=http://ollama:11434
#      OLLAMA_MODEL=llama3.2:3b
# 2. Start with the llm profile (combine with https if you use it):
sudo docker compose --profile https --profile llm up -d --build
# 3. One-time: pull the model
sudo docker compose --profile llm exec ollama ollama pull llama3.2:3b
```

> Runs on CPU (a few seconds per import; a GPU is faster). If RAM is tight, use a smaller
> model like `llama3.2:1b`. Leave `OLLAMA_URL` blank to disable AI and use the heuristic.

### Updating to a new version

```bash
./update.sh --https --ai     # pulls latest, rebuilds, restarts, health-checks
```

### Where your data lives

Everything (the SQLite database + uploaded images) is stored in the
`doughnotes-data` Docker volume, so it survives rebuilds and updates.

```bash
# Back it up
sudo docker run --rm -v doughnotes-data:/data -v "$PWD":/backup busybox \
  tar czf /backup/doughnotes-backup.tar.gz -C /data .
```

### Common commands

```bash
sudo docker compose ps              # what's running
sudo docker compose logs -f         # watch logs (add a service name, e.g. caddy)
sudo docker compose down            # stop (data is kept in the volume)
sudo docker compose restart         # restart
```

## Develop locally

Prerequisites: [Node.js 22+](https://nodejs.org/).

```bash
# Install dependencies
cd server && npm install && cd ..
cd client && npm install && cd ..

# Run the API (terminal 1) — http://localhost:3500
cd server && npm run dev

# Run the client dev server (terminal 2) — http://localhost:5173
cd client && npm run dev
```

The Vite dev server proxies `/api` to the server on port 3500. For the API alone,
copy `server/.env.example` to `server/.env` and set `JWT_SECRET`.

## How it's built

- **Client** — React 19 + Vite (`client/`)
- **Server** — Node.js + Express 5 (`server/`)
- **Database** — SQLite via better-sqlite3 (a single file in the data volume)
- **Images** — stored on the local volume today; Google Drive integration is planned
- **Deploy** — one multi-stage Docker image; the client is built and served by Express

## License

[GPL-3.0](LICENSE)
