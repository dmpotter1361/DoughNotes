import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';
import { addLabels, ingredientsFromRecipes } from './shopping.js';

const router = Router();

// Shape a plan row with the recipe's title for display.
function withRecipe(row) {
  const r = db.prepare('SELECT title FROM recipes WHERE id = ?').get(row.recipe_id);
  return { id: row.id, plan_date: row.plan_date, slot: row.slot, recipe_id: row.recipe_id, title: r?.title ?? '(deleted recipe)' };
}

// GET /api/planner?start=YYYY-MM-DD — 7 days from start (inclusive).
router.get('/', requireAuth, (req, res) => {
  const start = (req.query.start ?? '').toString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return res.status(400).json({ error: 'start (YYYY-MM-DD) is required' });
  const end = new Date(start + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + 6);
  const endStr = end.toISOString().slice(0, 10);
  const rows = db
    .prepare('SELECT * FROM meal_plan WHERE user_id = ? AND plan_date BETWEEN ? AND ? ORDER BY plan_date, id')
    .all(req.user.id, start, endStr);
  res.json({ entries: rows.map(withRecipe) });
});

// POST /api/planner { plan_date, recipe_id, slot? }
router.post('/', requireAuth, (req, res) => {
  const { plan_date, recipe_id, slot } = req.body ?? {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan_date || '')) return res.status(400).json({ error: 'Valid plan_date required' });
  const recipe = db.prepare('SELECT user_id, is_published FROM recipes WHERE id = ?').get(recipe_id);
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
  if (recipe.user_id !== req.user.id && !recipe.is_published) {
    return res.status(403).json({ error: 'You can only plan your own or published recipes' });
  }
  const info = db
    .prepare('INSERT INTO meal_plan (user_id, plan_date, recipe_id, slot) VALUES (?, ?, ?, ?)')
    .run(req.user.id, plan_date, recipe_id, (slot ?? '').trim() || null);
  res.status(201).json({ entry: withRecipe(db.prepare('SELECT * FROM meal_plan WHERE id = ?').get(info.lastInsertRowid)) });
});

// DELETE /api/planner/:id
router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM meal_plan WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// POST /api/planner/shopping { start } — add a week's planned recipes to the shopping list.
router.post('/shopping', requireAuth, (req, res) => {
  const start = (req.body?.start ?? '').toString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return res.status(400).json({ error: 'start (YYYY-MM-DD) is required' });
  const end = new Date(start + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + 6);
  const endStr = end.toISOString().slice(0, 10);
  // Count how many times each recipe is planned this week so a recipe scheduled on
  // multiple days contributes that many servings' worth of ingredients (they get summed).
  const counts = db
    .prepare('SELECT recipe_id, COUNT(*) AS n FROM meal_plan WHERE user_id = ? AND plan_date BETWEEN ? AND ? GROUP BY recipe_id')
    .all(req.user.id, start, endStr);
  const expandedIds = [];
  for (const { recipe_id, n } of counts) {
    for (let i = 0; i < n; i++) expandedIds.push(recipe_id);
  }
  const added = addLabels(req.user.id, ingredientsFromRecipes(req.user.id, expandedIds));
  res.json({ added, recipes: counts.length });
});

export default router;
