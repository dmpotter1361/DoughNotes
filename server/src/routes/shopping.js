import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';
import { parseJson } from '../util.js';

const router = Router();

// Add a set of ingredient labels to the user's list, skipping ones already present
// (case-insensitive exact match) so the same line isn't duplicated.
export function addLabels(userId, labels) {
  const existing = new Set(
    db.prepare('SELECT lower(label) AS l FROM shopping_items WHERE user_id = ?').all(userId).map((r) => r.l)
  );
  const insert = db.prepare('INSERT INTO shopping_items (user_id, label) VALUES (?, ?)');
  let added = 0;
  for (const raw of labels) {
    const label = String(raw).trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);
    insert.run(userId, label);
    added++;
  }
  return added;
}

// Gather ingredient lines from recipes the user is allowed to see (own or published).
export function ingredientsFromRecipes(userId, recipeIds) {
  const labels = [];
  for (const id of recipeIds) {
    const r = db.prepare('SELECT user_id, is_published, ingredients FROM recipes WHERE id = ?').get(id);
    if (!r) continue;
    if (r.user_id !== userId && !r.is_published) continue; // can't pull from others' private recipes
    labels.push(...parseJson(r.ingredients, []));
  }
  return labels;
}

// GET /api/shopping
router.get('/', requireAuth, (req, res) => {
  const items = db.prepare('SELECT id, label, checked FROM shopping_items WHERE user_id = ? ORDER BY checked, id').all(req.user.id);
  res.json({ items: items.map((i) => ({ ...i, checked: !!i.checked })) });
});

// POST /api/shopping/add { recipe_ids: [] } — add merged ingredients from recipes.
router.post('/add', requireAuth, (req, res) => {
  const ids = Array.isArray(req.body?.recipe_ids) ? req.body.recipe_ids : [];
  const added = addLabels(req.user.id, ingredientsFromRecipes(req.user.id, ids));
  res.json({ added });
});

// POST /api/shopping/items { labels: [] } — add arbitrary lines.
router.post('/items', requireAuth, (req, res) => {
  const labels = Array.isArray(req.body?.labels) ? req.body.labels : [];
  const added = addLabels(req.user.id, labels);
  res.json({ added });
});

// PATCH /api/shopping/:id { checked }
router.patch('/:id', requireAuth, (req, res) => {
  const item = db.prepare('SELECT * FROM shopping_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  db.prepare('UPDATE shopping_items SET checked = ? WHERE id = ?').run(req.body?.checked ? 1 : 0, item.id);
  res.json({ ok: true });
});

// DELETE /api/shopping/:id
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM shopping_items WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// DELETE /api/shopping?checked=1 — clear checked items, or all if not specified.
router.delete('/', requireAuth, (req, res) => {
  if (req.query.checked === '1') {
    db.prepare('DELETE FROM shopping_items WHERE user_id = ? AND checked = 1').run(req.user.id);
  } else {
    db.prepare('DELETE FROM shopping_items WHERE user_id = ?').run(req.user.id);
  }
  res.json({ ok: true });
});

export default router;
