# DoughNotes

<p align="center">
  <img src="docs/icon.png" width="96" alt="DoughNotes icon"><br>
</p>

A self-hosted baking recipe book, tracker, and journal. Save your recipes, log your bakes, attach photos, and build up your personal collection over time — all from the browser, running on your own machine.

> Personal project. Spin it up, make it yours.

## Features

- **Recipe book** — save, edit, and browse your baking recipes
- **Bake log** — track each bake with notes, dates, and outcomes
- **Photo support** — attach photos to recipes and bake entries
- **Journal** — free-form notes for your baking journey
- **Self-hosted** — runs as a single Docker container; your data stays with you

## Self-hosting

Prerequisites: [Docker](https://docs.docker.com/get-docker/).

```bash
git clone https://github.com/dmpotter1361/DoughNotes.git
cd DoughNotes
cp server/.env.example .env
docker compose up -d
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Development

Prerequisites: [Node.js 22+](https://nodejs.org/).

```bash
# Install dependencies
cd server && npm install && cd ..
cd client && npm install && cd ..

# Start both (in separate terminals)
cd server && npm run dev
cd client && npm run dev
```

The client dev server runs on port 5173 and proxies `/api` requests to the server on port 3000.

## License

[GPL-3.0](LICENSE)
