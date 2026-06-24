import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Data dir holds the SQLite file + locally-stored uploads. In Docker this is a
// mounted volume so everything survives container rebuilds.
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

export const DATA_DIR = dataDir;
export const UPLOADS_DIR = path.join(dataDir, 'uploads');

const db = new Database(path.join(dataDir, 'doughnotes.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
    is_active     INTEGER NOT NULL DEFAULT 1,
    drive_linked  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS recipes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    slug          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    prep_min      INTEGER,
    cook_min      INTEGER,
    servings      INTEGER,
    ingredients   TEXT NOT NULL DEFAULT '[]',     -- JSON array
    steps         TEXT NOT NULL DEFAULT '[]',     -- JSON array
    is_published  INTEGER NOT NULL DEFAULT 0,
    cover_image_id INTEGER,                        -- chosen cover photo (recipe_images.id)
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_id);
  CREATE INDEX IF NOT EXISTS idx_recipes_published ON recipes(is_published);

  CREATE TABLE IF NOT EXISTS recipe_images (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id      INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    storage        TEXT NOT NULL DEFAULT 'local',  -- 'local' | 'drive'
    local_filename TEXT,
    drive_file_id  TEXT,
    drive_url      TEXT,
    step_index     INTEGER,                         -- null = general photo; N = belongs to step N
    sort_order     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_images_recipe ON recipe_images(recipe_id);

  CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS recipe_tags (
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (recipe_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS collections (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS collection_recipes (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    recipe_id     INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, recipe_id)
  );

  CREATE TABLE IF NOT EXISTS bake_logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id      INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    baked_at       TEXT NOT NULL,
    notes          TEXT NOT NULL DEFAULT '',
    outcome_rating INTEGER,                        -- 1-5
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bakes_recipe ON bake_logs(recipe_id);

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_comments_recipe ON comments(recipe_id);

  CREATE TABLE IF NOT EXISTS ratings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stars      INTEGER NOT NULL,            -- 1-5
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (recipe_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_ratings_recipe ON ratings(recipe_id);

  CREATE TABLE IF NOT EXISTS google_accounts (
    user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    google_email    TEXT,
    refresh_token   TEXT NOT NULL,
    access_token    TEXT,
    token_expiry    INTEGER,          -- epoch ms when access_token expires
    drive_folder_id TEXT,             -- id of the user's DoughNotes/ Drive folder
    linked_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// --- Lightweight migrations: add columns to tables that predate them ---
// (CREATE TABLE IF NOT EXISTS won't alter an existing table, so older databases
// on already-deployed servers need these.)
function ensureColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('recipes', 'cover_image_id', 'INTEGER');
ensureColumn('recipe_images', 'step_index', 'INTEGER');

export default db;
