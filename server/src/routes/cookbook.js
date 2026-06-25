import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';
import { hydrate } from './recipes.js';
import { buildRecipeBook } from '../pdf.js';

const router = Router();

// Gather the user's OWN recipes for a cookbook. scope: 'all' (default) | 'published'.
export function gatherForCookbook(userId, scope) {
  const sql = scope === 'published'
    ? 'SELECT * FROM recipes WHERE user_id = ? AND is_published = 1 ORDER BY title'
    : 'SELECT * FROM recipes WHERE user_id = ? ORDER BY title';
  return db.prepare(sql).all(userId).map(hydrate);
}

// GET /api/cookbook.pdf?title=&scope=all|published&seed= — stream a cookbook download.
// No Google Drive needed; works for anyone with recipes.
router.get('/cookbook.pdf', requireAuth, async (req, res) => {
  const title = (req.query.title || 'My Cookbook').toString().trim().slice(0, 100) || 'My Cookbook';
  const scope = req.query.scope === 'published' ? 'published' : 'all';
  const seed = Number(req.query.seed) || 1;
  const recipes = gatherForCookbook(req.user.id, scope);
  if (recipes.length === 0) {
    return res.status(400).json({ error: 'You have no recipes to put in a cookbook yet.' });
  }
  try {
    const pdf = await buildRecipeBook({ title, recipes, seed });
    const safe = title.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'cookbook';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('Cookbook PDF error:', e.message);
    res.status(500).json({ error: 'Could not build the cookbook PDF' });
  }
});

export default router;
