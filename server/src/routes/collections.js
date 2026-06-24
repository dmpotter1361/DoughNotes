import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

// GET /api/tags — all known tags (for autocomplete / filtering).
router.get('/tags', (_req, res) => {
  const tags = db.prepare('SELECT name FROM tags ORDER BY name').all().map((t) => t.name);
  res.json({ tags });
});

function withCount(row) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM collection_recipes WHERE collection_id = ?').get(row.id).n;
  return { id: row.id, name: row.name, recipe_count: count };
}

// GET /api/collections — the user's own collections.
router.get('/collections', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM collections WHERE user_id = ? ORDER BY name').all(req.user.id);
  res.json({ collections: rows.map(withCount) });
});

// POST /api/collections
router.post('/collections', requireAuth, (req, res) => {
  const name = (req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Collection name is required' });
  const info = db.prepare('INSERT INTO collections (user_id, name) VALUES (?, ?)').run(req.user.id, name);
  res.status(201).json({ collection: withCount(db.prepare('SELECT * FROM collections WHERE id = ?').get(info.lastInsertRowid)) });
});

// Ownership guard for a collection.
function ownedCollectionOr404(req, res) {
  const col = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
  if (!col) {
    res.status(404).json({ error: 'Collection not found' });
    return null;
  }
  if (col.user_id !== req.user.id) {
    res.status(403).json({ error: 'Not your collection' });
    return null;
  }
  return col;
}

// DELETE /api/collections/:id
router.delete('/collections/:id', requireAuth, (req, res) => {
  const col = ownedCollectionOr404(req, res);
  if (!col) return;
  db.prepare('DELETE FROM collections WHERE id = ?').run(col.id);
  res.json({ ok: true });
});

// PUT /api/collections/:id/recipes/:recipeId — add a recipe to a collection.
router.put('/collections/:id/recipes/:recipeId', requireAuth, (req, res) => {
  const col = ownedCollectionOr404(req, res);
  if (!col) return;
  const recipe = db.prepare('SELECT user_id FROM recipes WHERE id = ?').get(req.params.recipeId);
  if (!recipe || recipe.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Recipe not found' });
  }
  db.prepare('INSERT OR IGNORE INTO collection_recipes (collection_id, recipe_id) VALUES (?, ?)').run(col.id, req.params.recipeId);
  res.json({ ok: true });
});

// DELETE /api/collections/:id/recipes/:recipeId
router.delete('/collections/:id/recipes/:recipeId', requireAuth, (req, res) => {
  const col = ownedCollectionOr404(req, res);
  if (!col) return;
  db.prepare('DELETE FROM collection_recipes WHERE collection_id = ? AND recipe_id = ?').run(col.id, req.params.recipeId);
  res.json({ ok: true });
});

export default router;
