import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';
import { parseJson } from '../util.js';
import { parseIngredient, formatLabel, categoryFor, SECTION_ORDER } from '../shopping_parse.js';

const router = Router();

// Add ingredient lines, SUMMING quantities into matching items (same name + base unit)
// instead of skipping duplicates. Free-text lines (no parseable quantity) de-dupe by name.
export function addLabels(userId, labels) {
  const findQty = db.prepare(
    'SELECT id, qty FROM shopping_items WHERE user_id = ? AND checked = 0 AND name = ? AND unit IS ?'
  );
  const findText = db.prepare(
    "SELECT id FROM shopping_items WHERE user_id = ? AND checked = 0 AND name = ? AND unit IS NULL"
  );
  const insert = db.prepare(
    'INSERT INTO shopping_items (user_id, label, qty, unit, name, category) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const update = db.prepare('UPDATE shopping_items SET qty = ?, label = ? WHERE id = ?');
  let added = 0;
  for (const raw of labels) {
    const p = parseIngredient(raw);
    if (!p.raw) continue;
    if (p.qty == null) {
      // Free text — keep the old behavior: skip if an identical item already exists.
      if (!p.name) { insert.run(userId, p.raw, null, null, null, p.category); added++; continue; }
      if (findText.get(userId, p.name)) continue;
      insert.run(userId, p.display || p.raw, null, null, p.name, p.category);
      added++;
      continue;
    }
    const existing = findQty.get(userId, p.name, p.unit);
    if (existing) {
      const qty = (existing.qty || 0) + p.qty;
      update.run(qty, formatLabel({ qty, unit: p.unit, display: p.display }), existing.id);
    } else {
      insert.run(userId, formatLabel(p), p.qty, p.unit, p.name, p.category);
      added++;
    }
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

// GET /api/shopping — items with their store section, ordered by typical store flow.
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, label, checked, name, category FROM shopping_items WHERE user_id = ? ORDER BY id').all(req.user.id);
  const rank = (c) => { const i = SECTION_ORDER.indexOf(c); return i === -1 ? SECTION_ORDER.length : i; };
  const items = rows
    .map((r) => ({
      id: r.id,
      label: r.label,
      checked: !!r.checked,
      category: r.category || categoryFor(r.name || r.label), // backfill for legacy rows
    }))
    .sort((a, b) =>
      a.checked - b.checked ||
      rank(a.category) - rank(b.category) ||
      a.label.localeCompare(b.label)
    );
  res.json({ items });
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
