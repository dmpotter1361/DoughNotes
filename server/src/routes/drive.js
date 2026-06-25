import { Router } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import db, { UPLOADS_DIR } from '../db.js';
import { requireAuth } from '../auth.js';
import { hydrate } from './recipes.js';
import { buildRecipeBook } from '../pdf.js';
import { gatherForCookbook } from './cookbook.js';
import {
  driveConfigured, getAuthUrl, exchangeCode, saveLinkedAccount,
  getLinkedAccount, disconnect, uploadFile,
} from '../drive.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

function appUrl(pathPart) {
  const base = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3500}`).replace(/\/$/, '');
  return `${base}${pathPart}`;
}

// Move a user's existing local images into their Drive (best-effort, per image).
async function migrateLocalImages(userId) {
  const rows = db
    .prepare(
      `SELECT ri.* FROM recipe_images ri
       JOIN recipes r ON r.id = ri.recipe_id
       WHERE r.user_id = ? AND ri.storage = 'local' AND ri.local_filename IS NOT NULL`
    )
    .all(userId);

  let moved = 0;
  for (const img of rows) {
    try {
      const filePath = path.join(UPLOADS_DIR, img.local_filename);
      if (!fs.existsSync(filePath)) continue;
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(img.local_filename).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
      const fileId = await uploadFile(userId, { buffer, mimeType, name: `recipe-${img.recipe_id}-${img.id}${ext}` });
      db.prepare("UPDATE recipe_images SET storage = 'drive', drive_file_id = ?, local_filename = NULL WHERE id = ?")
        .run(fileId, img.id);
      fs.rm(filePath, { force: true }, () => {});
      moved++;
    } catch (e) {
      console.error(`Drive migration failed for image ${img.id}:`, e.message);
    }
  }
  return moved;
}

// GET /api/drive/connect — kick off OAuth. State is a short-lived signed token.
router.get('/connect', requireAuth, (req, res) => {
  if (!driveConfigured()) return res.status(503).json({ error: 'Google Drive is not configured on this server' });
  const state = jwt.sign({ uid: req.user.id }, JWT_SECRET, { expiresIn: '10m' });
  res.redirect(getAuthUrl(state));
});

// GET /api/drive/callback — Google redirects here with ?code & ?state.
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(appUrl('/account?drive=denied'));
  if (!code || !state) return res.redirect(appUrl('/account?drive=error'));

  let userId;
  try {
    userId = jwt.verify(state, JWT_SECRET).uid;
  } catch {
    return res.redirect(appUrl('/account?drive=error'));
  }

  try {
    const { tokens, email } = await exchangeCode(code);
    if (!tokens.refresh_token) {
      // Happens if the user previously linked and Google didn't re-issue one.
      return res.redirect(appUrl('/account?drive=norefresh'));
    }
    await saveLinkedAccount(userId, tokens, email);
    await migrateLocalImages(userId);
    res.redirect(appUrl('/account?drive=connected'));
  } catch (e) {
    console.error('Drive callback error:', e.message);
    res.redirect(appUrl('/account?drive=error'));
  }
});

// GET /api/drive/status
router.get('/status', requireAuth, (req, res) => {
  const acct = getLinkedAccount(req.user.id);
  res.json({
    configured: driveConfigured(),
    linked: !!acct,
    google_email: acct?.google_email ?? null,
  });
});

// POST /api/drive/disconnect
router.post('/disconnect', requireAuth, async (req, res) => {
  await disconnect(req.user.id);
  res.json({ ok: true });
});

// POST /api/drive/export/recipe/:id — render this recipe as a PDF, save to Drive.
router.post('/export/recipe/:id', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Recipe not found' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'You can only export your own recipes' });
  if (!getLinkedAccount(req.user.id)) return res.status(400).json({ error: 'Connect Google Drive first' });
  try {
    const recipe = hydrate(row);
    const pdf = await buildRecipeBook({ title: recipe.title, recipes: [recipe] });
    const fileId = await uploadFile(req.user.id, {
      buffer: pdf, mimeType: 'application/pdf', name: `${recipe.slug || 'recipe'}.pdf`,
    });
    res.json({ link: `https://drive.google.com/file/d/${fileId}/view` });
  } catch (e) {
    console.error('PDF export error:', e.message);
    res.status(500).json({ error: 'Failed to export PDF to Drive' });
  }
});

// POST /api/drive/export/collection/:id — render a whole collection as a recipe book.
router.post('/export/collection/:id', requireAuth, async (req, res) => {
  const col = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
  if (!col) return res.status(404).json({ error: 'Collection not found' });
  if (col.user_id !== req.user.id) return res.status(403).json({ error: 'Not your collection' });
  if (!getLinkedAccount(req.user.id)) return res.status(400).json({ error: 'Connect Google Drive first' });
  const rows = db
    .prepare(
      `SELECT r.* FROM recipes r
       JOIN collection_recipes cr ON cr.recipe_id = r.id
       WHERE cr.collection_id = ? ORDER BY r.title`
    )
    .all(col.id);
  if (rows.length === 0) return res.status(400).json({ error: 'This collection has no recipes' });
  try {
    const pdf = await buildRecipeBook({ title: col.name, recipes: rows.map(hydrate) });
    const fileId = await uploadFile(req.user.id, {
      buffer: pdf, mimeType: 'application/pdf', name: `${col.name}.pdf`,
    });
    res.json({ link: `https://drive.google.com/file/d/${fileId}/view` });
  } catch (e) {
    console.error('PDF export error:', e.message);
    res.status(500).json({ error: 'Failed to export PDF to Drive' });
  }
});

// POST /api/drive/export/cookbook { title, scope, seed } — render the user's recipes
// as one cookbook PDF and save it to their Drive.
router.post('/export/cookbook', requireAuth, async (req, res) => {
  if (!getLinkedAccount(req.user.id)) return res.status(400).json({ error: 'Connect Google Drive first' });
  const title = (req.body?.title || 'My Cookbook').toString().trim().slice(0, 100) || 'My Cookbook';
  const scope = req.body?.scope === 'published' ? 'published' : 'all';
  const seed = Number(req.body?.seed) || 1;
  const recipes = gatherForCookbook(req.user.id, scope);
  if (recipes.length === 0) return res.status(400).json({ error: 'You have no recipes to put in a cookbook yet.' });
  try {
    const pdf = await buildRecipeBook({ title, recipes, seed });
    const fileId = await uploadFile(req.user.id, { buffer: pdf, mimeType: 'application/pdf', name: `${title}.pdf` });
    res.json({ link: `https://drive.google.com/file/d/${fileId}/view` });
  } catch (e) {
    console.error('Cookbook Drive export error:', e.message);
    res.status(500).json({ error: 'Failed to export cookbook to Drive' });
  }
});

export default router;
export { migrateLocalImages };
