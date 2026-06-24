import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

// The bake log is private: only the recipe owner can see or write their own bakes.
function ownedRecipeOr404(req, res) {
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.recipeId);
  if (!recipe) {
    res.status(404).json({ error: 'Recipe not found' });
    return null;
  }
  if (recipe.user_id !== req.user.id) {
    res.status(403).json({ error: 'The bake log is private to the recipe owner' });
    return null;
  }
  return recipe;
}

// GET /api/recipes/:recipeId/bakes
router.get('/recipes/:recipeId/bakes', requireAuth, (req, res) => {
  const recipe = ownedRecipeOr404(req, res);
  if (!recipe) return;
  const bakes = db
    .prepare('SELECT * FROM bake_logs WHERE recipe_id = ? ORDER BY baked_at DESC, id DESC')
    .all(recipe.id);
  res.json({ bakes });
});

// POST /api/recipes/:recipeId/bakes
router.post('/recipes/:recipeId/bakes', requireAuth, (req, res) => {
  const recipe = ownedRecipeOr404(req, res);
  if (!recipe) return;
  const { baked_at, notes, outcome_rating } = req.body ?? {};
  const date = (baked_at || '').trim() || new Date().toISOString().slice(0, 10);
  const rating = outcome_rating ? Math.max(1, Math.min(5, Number(outcome_rating))) : null;

  const info = db
    .prepare('INSERT INTO bake_logs (recipe_id, user_id, baked_at, notes, outcome_rating) VALUES (?, ?, ?, ?, ?)')
    .run(recipe.id, req.user.id, date, (notes ?? '').trim(), rating);
  res.status(201).json({ bake: db.prepare('SELECT * FROM bake_logs WHERE id = ?').get(info.lastInsertRowid) });
});

// DELETE /api/bakes/:id
router.delete('/bakes/:id', requireAuth, (req, res) => {
  const bake = db.prepare('SELECT * FROM bake_logs WHERE id = ?').get(req.params.id);
  if (!bake) return res.status(404).json({ error: 'Bake entry not found' });
  if (bake.user_id !== req.user.id) return res.status(403).json({ error: 'Not your bake entry' });
  db.prepare('DELETE FROM bake_logs WHERE id = ?').run(bake.id);
  res.json({ ok: true });
});

export default router;
