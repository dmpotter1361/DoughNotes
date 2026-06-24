import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

// A comment/rating is allowed on a recipe the caller can see: published, or their own.
function viewableRecipe(req, res) {
  const recipe = db.prepare('SELECT id, user_id, is_published FROM recipes WHERE id = ?').get(req.params.id);
  if (!recipe) {
    res.status(404).json({ error: 'Recipe not found' });
    return null;
  }
  const isOwner = req.user && req.user.id === recipe.user_id;
  if (!recipe.is_published && !isOwner) {
    res.status(403).json({ error: 'This recipe is private' });
    return null;
  }
  return recipe;
}

// --- Comments ---

// GET /api/recipes/:id/comments
router.get('/recipes/:id/comments', (req, res) => {
  const recipe = viewableRecipe(req, res);
  if (!recipe) return;
  const comments = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.user_id, u.display_name AS author
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.recipe_id = ? ORDER BY c.created_at DESC`
    )
    .all(recipe.id);
  res.json({ comments });
});

// POST /api/recipes/:id/comments — must be logged in; recipe must be published.
router.post('/recipes/:id/comments', requireAuth, (req, res) => {
  const recipe = viewableRecipe(req, res);
  if (!recipe) return;
  if (!recipe.is_published) return res.status(403).json({ error: 'You can only comment on published recipes' });
  const body = (req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'Comment cannot be empty' });

  const info = db.prepare('INSERT INTO comments (recipe_id, user_id, body) VALUES (?, ?, ?)').run(recipe.id, req.user.id, body);
  const comment = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.user_id, u.display_name AS author
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json({ comment });
});

// DELETE /api/comments/:id — comment author OR the recipe owner.
router.delete('/comments/:id', requireAuth, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const recipe = db.prepare('SELECT user_id FROM recipes WHERE id = ?').get(comment.recipe_id);
  const isAuthor = comment.user_id === req.user.id;
  const isRecipeOwner = recipe && recipe.user_id === req.user.id;
  if (!isAuthor && !isRecipeOwner) {
    return res.status(403).json({ error: 'You can only delete your own comments' });
  }
  db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
  res.json({ ok: true });
});

// --- Ratings ---

function ratingSummary(recipeId, userId) {
  const agg = db.prepare('SELECT AVG(stars) AS avg, COUNT(*) AS count FROM ratings WHERE recipe_id = ?').get(recipeId);
  const mine = userId ? db.prepare('SELECT stars FROM ratings WHERE recipe_id = ? AND user_id = ?').get(recipeId, userId) : null;
  return {
    avg: agg.avg ? Math.round(agg.avg * 10) / 10 : 0,
    count: agg.count,
    my_rating: mine?.stars ?? null,
  };
}

// GET /api/recipes/:id/rating
router.get('/recipes/:id/rating', (req, res) => {
  const recipe = viewableRecipe(req, res);
  if (!recipe) return;
  res.json(ratingSummary(recipe.id, req.user?.id));
});

// PUT /api/recipes/:id/rating — upsert the caller's star rating (published only).
router.put('/recipes/:id/rating', requireAuth, (req, res) => {
  const recipe = viewableRecipe(req, res);
  if (!recipe) return;
  if (!recipe.is_published) return res.status(403).json({ error: 'You can only rate published recipes' });
  const stars = Number(req.body?.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
  }
  db.prepare(
    `INSERT INTO ratings (recipe_id, user_id, stars) VALUES (?, ?, ?)
     ON CONFLICT(recipe_id, user_id) DO UPDATE SET stars = excluded.stars`
  ).run(recipe.id, req.user.id, stars);
  res.json(ratingSummary(recipe.id, req.user.id));
});

export default router;
