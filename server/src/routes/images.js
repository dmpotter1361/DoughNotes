import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Readable } from 'stream';
import db, { UPLOADS_DIR } from '../db.js';
import { requireAuth } from '../auth.js';
import { getLinkedAccount, uploadFile, downloadFile, deleteFile } from '../drive.js';
import { canEditRecipe } from './recipes.js';

const router = Router();

const ONE_MB = 1024 * 1024;
const DRIVE_MAX = 20 * 1024 * 1024; // generous cap once a user is on Drive
const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

// Buffer in memory, then route to Drive or local disk based on the user's status.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DRIVE_MAX },
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
  if (recipe.user_id !== req.user.id && !canEditRecipe(recipe.id, req.user.id)) {
    res.status(403).json({ error: 'You do not have edit access to this recipe' });
    return null;
  }
  return recipe;
}

// POST /api/recipes/:recipeId/images — upload one image. Goes to the user's Google
// Drive if they've linked it (up to 20 MB), otherwise local disk (1 MB cap).
router.post('/recipes/:recipeId/images', requireAuth, (req, res) => {
  const recipe = ownedRecipeOr404(req, res);
  if (!recipe) return;

  upload.single('image')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 20 MB or smaller' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    const linked = !!getLinkedAccount(req.user.id);
    const ext = ALLOWED.get(req.file.mimetype);
    // Optional: which step this photo belongs to (null = general/gallery photo).
    const stepIndex = req.body?.step_index !== undefined && req.body.step_index !== ''
      ? Number(req.body.step_index)
      : null;
    const maxOrder = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM recipe_images WHERE recipe_id = ?')
      .get(recipe.id).m;

    try {
      let info;
      if (linked) {
        const fileId = await uploadFile(req.user.id, {
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
          name: `recipe-${recipe.id}-${Date.now()}${ext}`,
        });
        info = db
          .prepare('INSERT INTO recipe_images (recipe_id, storage, drive_file_id, step_index, sort_order) VALUES (?, ?, ?, ?, ?)')
          .run(recipe.id, 'drive', fileId, stepIndex, maxOrder + 1);
      } else {
        if (req.file.size > ONE_MB) {
          return res.status(400).json({ error: 'Image must be 1 MB or smaller — connect Google Drive for larger photos' });
        }
        const filename = `${crypto.randomUUID()}${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
        info = db
          .prepare('INSERT INTO recipe_images (recipe_id, storage, local_filename, step_index, sort_order) VALUES (?, ?, ?, ?, ?)')
          .run(recipe.id, 'local', filename, stepIndex, maxOrder + 1);
      }
      res.status(201).json({ image: { id: info.lastInsertRowid, url: `/api/images/${info.lastInsertRowid}`, step_index: stepIndex } });
    } catch (e) {
      console.error('Image upload error:', e.message);
      res.status(500).json({ error: 'Failed to save image' });
    }
  });
});

// GET /api/images/:id — serve an image (published recipe, or owner). Drive-backed
// images are proxied through the server using the *owner's* token, so the privacy
// model is identical to local images and the URL stays stable for the frontend.
router.get('/images/:id', async (req, res) => {
  const img = db.prepare('SELECT * FROM recipe_images WHERE id = ?').get(req.params.id);
  if (!img) return res.status(404).json({ error: 'Image not found' });

  const recipe = db.prepare('SELECT user_id, is_published FROM recipes WHERE id = ?').get(img.recipe_id);
  const isOwner = req.user && recipe && req.user.id === recipe.user_id;
  if (!recipe || (!recipe.is_published && !isOwner)) {
    return res.status(403).json({ error: 'Image is private' });
  }

  if (img.storage === 'drive' && img.drive_file_id) {
    try {
      const { contentType, body } = await downloadFile(recipe.user_id, img.drive_file_id);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      Readable.fromWeb(body).pipe(res);
    } catch (e) {
      console.error('Drive image fetch failed:', e.message);
      res.status(502).json({ error: 'Could not load image from Drive' });
    }
    return;
  }

  if (img.storage === 'local' && img.local_filename) {
    return res.sendFile(path.join(UPLOADS_DIR, img.local_filename));
  }
  res.status(404).json({ error: 'Image not found' });
});

// PATCH /api/images/:id — owner reassigns an image's step (null = general photo).
router.patch('/images/:id', requireAuth, (req, res) => {
  const img = db.prepare('SELECT * FROM recipe_images WHERE id = ?').get(req.params.id);
  if (!img) return res.status(404).json({ error: 'Image not found' });
  const recipe = db.prepare('SELECT user_id FROM recipes WHERE id = ?').get(img.recipe_id);
  if (!recipe || !canEditRecipe(img.recipe_id, req.user.id)) {
    return res.status(403).json({ error: 'You do not have edit access to this recipe' });
  }
  const stepIndex = req.body?.step_index === null || req.body?.step_index === undefined
    ? null
    : Number(req.body.step_index);
  db.prepare('UPDATE recipe_images SET step_index = ? WHERE id = ?').run(stepIndex, img.id);
  res.json({ ok: true });
});

// DELETE /api/images/:id — owner removes an image (also deletes the stored file).
router.delete('/images/:id', requireAuth, async (req, res) => {
  const img = db.prepare('SELECT * FROM recipe_images WHERE id = ?').get(req.params.id);
  if (!img) return res.status(404).json({ error: 'Image not found' });
  const recipe = db.prepare('SELECT user_id FROM recipes WHERE id = ?').get(img.recipe_id);
  if (!recipe || !canEditRecipe(img.recipe_id, req.user.id)) {
    return res.status(403).json({ error: 'You do not have edit access to this recipe' });
  }

  if (img.storage === 'drive' && img.drive_file_id) {
    await deleteFile(req.user.id, img.drive_file_id);
  } else if (img.storage === 'local' && img.local_filename) {
    fs.rm(path.join(UPLOADS_DIR, img.local_filename), { force: true }, () => {});
  }
  // If this was the recipe's cover, clear the reference.
  db.prepare('UPDATE recipes SET cover_image_id = NULL WHERE cover_image_id = ?').run(img.id);
  db.prepare('DELETE FROM recipe_images WHERE id = ?').run(img.id);
  res.json({ ok: true });
});

export default router;
