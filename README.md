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
- **Print-friendly** — clean print/PDF view of any recipe

## Run it on your server (from GitHub)

Prerequisites: a machine with [Docker](https://docs.docker.com/get-docker/) and
[Git](https://git-scm.com/) (Docker Compose ships with Docker today).

```bash
# 1. Get the code
git clone https://github.com/dmpotter1361/DoughNotes.git
cd DoughNotes

# 2. Create your .env (sets the session secret)
cp .env.example .env
#   then edit .env and set JWT_SECRET to a long random string, e.g.:
#   openssl rand -hex 32

# 3. Build and start (runs in the background)
docker compose up -d --build
```

Open **http://<your-server>:3500** and register — the **first account becomes the
admin**. (Port 3500 is a nod to 350°F. 🔥)

> **Plain HTTP vs HTTPS:** out of the box this runs over plain HTTP, which is fine
> for testing. When you put it behind HTTPS (e.g. a reverse proxy), set
> `COOKIE_SECURE=true` in your `.env` so session cookies are sent securely — leave
> it `false` for plain HTTP or logins won't work.

### Updating to a new version

```bash
git pull
docker compose up -d --build
```

### Where your data lives

Everything (the SQLite database + uploaded images) is stored in the
`doughnotes-data` Docker volume, so it survives rebuilds and updates.

```bash
# Back it up
docker run --rm -v doughnotes-data:/data -v "$PWD":/backup busybox \
  tar czf /backup/doughnotes-backup.tar.gz -C /data .
```

### Common commands

```bash
docker compose logs -f      # watch logs
docker compose down         # stop (data is kept in the volume)
docker compose restart      # restart
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
