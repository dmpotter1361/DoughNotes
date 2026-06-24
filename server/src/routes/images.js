import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from '../db.js';
import { requireAuth } from '../auth.js';
import { UPLOADS_DIR } from '../db.js';

const router = Router();

const ONE_MB = 1024 * 1024;
const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = ALLOWED.get(file.mimetype) || '.bin';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: ONE_MB },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WebP, or GIF images are allowed'));
    }
    cb(null, true);
  },
});

// Confirm the recipe belongs to the caller, else null (response already sent).
function ownedRecipeOr404(req, res) {
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.recipeId);
  if (!recipe) {
    res.status(404).json({ error: 'Recipe not found' });
    return null;
  }
  if (recipe.user_id !== req.user.id) {
    res.status(403).json({ error: 'You can only edit your own recipes' });
    return null;
  }
  return recipe;
}

// POST /api/recipes/:recipeId/images — upload one image (local storage, 1MB cap).
// Drive-backed storage is layered on later; for now everything is 'local'.
router.post('/recipes/:recipeId/images', requireAuth, (req, res) => {
  const recipe = ownedRecipeOr404(req, res);
  if (!recipe) return;

  upload.single('image')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 1 MB or smaller' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    const maxOrder = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM recipe_images WHERE recipe_id = ?')
      .get(recipe.id).m;
    const info = db
      .prepare('INSERT INTO recipe_images (recipe_id, storage, local_filename, sort_order) VALUES (?, ?, ?, ?)')
      .run(recipe.id, 'local', req.file.filename, maxOrder + 1);

    res.status(201).json({ image: { id: info.lastInsertRowid, url: `/api/images/${info.lastInsertRowid}` } });
  });
});

// GET /api/images/:id — serve a locally-stored image (published recipe, or owner).
router.get('/images/:id', (req, res) => {
  const img = db.prepare('SELECT * FROM recipe_images WHERE id = ?').get(req.params.id);
  if (!img || img.storage !== 'local' || !img.local_filename) {
    return res.status(404).json({ error: 'Image not found' });
  }
  const recipe = db.prepare('SELECT user_id, is_published FROM recipes WHERE id = ?').get(img.recipe_id);
  const isOwner = req.user && recipe && req.user.id === recipe.user_id;
  if (!recipe || (!recipe.is_published && !isOwner)) {
    return res.status(403).json({ error: 'Image is private' });
  }
  res.sendFile(path.join(UPLOADS_DIR, img.local_filename));
});

// DELETE /api/images/:id — owner removes an image (also deletes the file).
router.delete('/images/:id', requireAuth, (req, res) => {
  const img = db.prepare('SELECT * FROM recipe_images WHERE id = ?').get(req.params.id);
  if (!img) return res.status(404).json({ error: 'Image not found' });
  const recipe = db.prepare('SELECT user_id FROM recipes WHERE id = ?').get(img.recipe_id);
  if (!recipe || recipe.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit your own recipes' });
  }
  if (img.storage === 'local' && img.local_filename) {
    fs.rm(path.join(UPLOADS_DIR, img.local_filename), { force: true }, () => {});
  }
  db.prepare('DELETE FROM recipe_images WHERE id = ?').run(img.id);
  res.json({ ok: true });
});

export default router;
