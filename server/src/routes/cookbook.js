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

// The user's saved cover design (parsed), or null if they haven't made one.
export function getCoverSpec(userId) {
  const row = db.prepare('SELECT spec FROM cookbook_covers WHERE user_id = ?').get(userId);
  if (!row) return null;
  try { return JSON.parse(row.spec); } catch { return null; }
}

const MAX_SPEC_BYTES = 8 * 1024 * 1024; // cap saved cover size (images ride inside the spec)

// Light validation of a cover spec submitted from the editor.
function validSpec(spec) {
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.objects)) return false;
  return Buffer.byteLength(JSON.stringify(spec), 'utf8') <= MAX_SPEC_BYTES;
}

// GET /api/cookbook/cover — load the saved cover design (or null).
router.get('/cookbook/cover', requireAuth, (req, res) => {
  res.json({ spec: getCoverSpec(req.user.id) });
});

// PUT /api/cookbook/cover { spec } — save/replace the user's cover design.
router.put('/cookbook/cover', requireAuth, (req, res) => {
  const spec = req.body?.spec;
  if (!validSpec(spec)) return res.status(400).json({ error: 'That cover is invalid or too large (max 8 MB, including images).' });
  db.prepare(
    `INSERT INTO cookbook_covers (user_id, spec, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET spec = excluded.spec, updated_at = excluded.updated_at`
  ).run(req.user.id, JSON.stringify(spec));
  res.json({ ok: true });
});

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
    const pdf = await buildRecipeBook({ title, recipes, seed, coverSpec: getCoverSpec(req.user.id) });
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
