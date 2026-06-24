import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import db, { UPLOADS_DIR } from '../db.js';
import { requireAuth } from '../auth.js';
import { slugify, parseJson, cleanLines } from '../util.js';
import { getLinkedAccount, uploadFile, downloadFile } from '../drive.js';

const router = Router();

const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

// Shape a recipe row for the client, attaching images + tags.
function hydrate(row) {
  if (!row) return null;
  // All images are served through the proxy endpoint (local from disk, drive
  // streamed via the owner's token) — same stable URL regardless of storage.
  const images = db
    .prepare('SELECT id, step_index, sort_order FROM recipe_images WHERE recipe_id = ? ORDER BY sort_order, id')
    .all(row.id)
    .map((img) => ({
      id: img.id,
      url: `/api/images/${img.id}`,
      step_index: img.step_index,
    }));
  const tags = db
    .prepare('SELECT t.name FROM tags t JOIN recipe_tags rt ON rt.tag_id = t.id WHERE rt.recipe_id = ? ORDER BY t.name')
    .all(row.id)
    .map((t) => t.name);
  const author = db.prepare('SELECT display_name FROM users WHERE id = ?').get(row.user_id);
  const rating = db.prepare('SELECT AVG(stars) AS avg, COUNT(*) AS count FROM ratings WHERE recipe_id = ?').get(row.id);

  // Cover: the chosen cover image if still present, else the first general photo.
  const coverImg = images.find((i) => i.id === row.cover_image_id)
    || images.find((i) => i.step_index === null)
    || images[0];

  return {
    id: row.id,
    user_id: row.user_id,
    author: author?.display_name ?? 'Unknown',
    title: row.title,
    slug: row.slug,
    description: row.description,
    prep_min: row.prep_min,
    cook_min: row.cook_min,
    servings: row.servings,
    ingredients: parseJson(row.ingredients, []),
    steps: parseJson(row.steps, []),
    is_published: !!row.is_published,
    images,
    cover_image_id: row.cover_image_id ?? null,
    cover_url: coverImg ? coverImg.url : null,
    tags,
    rating_avg: rating.avg ? Math.round(rating.avg * 10) / 10 : 0,
    rating_count: rating.count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Replace the tag set for a recipe (creates tags as needed).
function setTags(recipeId, tagNames) {
  const names = cleanLines(tagNames).map((t) => t.toLowerCase());
  db.prepare('DELETE FROM recipe_tags WHERE recipe_id = ?').run(recipeId);
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)');
  for (const name of new Set(names)) {
    insertTag.run(name);
    link.run(recipeId, getTag.get(name).id);
  }
}

// GET /api/recipes/public — community feed of published recipes (+ optional ?q= search).
router.get('/public', (req, res) => {
  const q = (req.query.q ?? '').toString().trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    // Match title, description, ingredients (stored as JSON text), or any tag name.
    rows = db
      .prepare(
        `SELECT DISTINCT r.* FROM recipes r
         LEFT JOIN recipe_tags rt ON rt.recipe_id = r.id
         LEFT JOIN tags t ON t.id = rt.tag_id
         WHERE r.is_published = 1
           AND (r.title LIKE ? OR r.description LIKE ? OR r.ingredients LIKE ? OR t.name LIKE ?)
         ORDER BY r.updated_at DESC`
      )
      .all(like, like, like, like);
  } else {
    rows = db.prepare('SELECT * FROM recipes WHERE is_published = 1 ORDER BY updated_at DESC').all();
  }
  res.json({ recipes: rows.map(hydrate) });
});

// GET /api/recipes/mine — the logged-in user's own recipes (any status).
router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM recipes WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
  res.json({ recipes: rows.map(hydrate) });
});

// Is this user a collaborator (co-creator) on the recipe?
function isCollaborator(recipeId, userId) {
  if (!userId) return false;
  return !!db.prepare('SELECT 1 FROM recipe_collaborators WHERE recipe_id = ? AND user_id = ?').get(recipeId, userId);
}

// GET /api/recipes/shared — recipes shared with the logged-in user (must precede /:id).
router.get('/shared', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.* FROM recipes r
       JOIN recipe_collaborators rc ON rc.recipe_id = r.id
       WHERE rc.user_id = ? ORDER BY r.updated_at DESC`
    )
    .all(req.user.id);
  res.json({ recipes: rows.map(hydrate) });
});

// GET /api/recipes/:id — owner/collaborator see private; anyone sees published.
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Recipe not found' });
  const isOwner = req.user && req.user.id === row.user_id;
  const canEdit = isOwner || isCollaborator(row.id, req.user?.id);
  if (!row.is_published && !canEdit) return res.status(403).json({ error: 'This recipe is private' });
  res.json({ recipe: hydrate(row), is_owner: !!isOwner, can_edit: !!canEdit });
});

// POST /api/recipes — create.
router.post('/', requireAuth, (req, res) => {
  const { title, description, prep_min, cook_min, servings, ingredients, steps, tags } = req.body ?? {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });

  const info = db
    .prepare(
      `INSERT INTO recipes (user_id, title, slug, description, prep_min, cook_min, servings, ingredients, steps)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      title.trim(),
      slugify(title),
      (description ?? '').trim(),
      prep_min || null,
      cook_min || null,
      servings || null,
      JSON.stringify(cleanLines(ingredients)),
      JSON.stringify(cleanLines(steps))
    );
  if (tags) setTags(info.lastInsertRowid, tags);

  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ recipe: hydrate(row) });
});

// POST /api/recipes/bulk — create several recipes at once (private), e.g. from a folder
// scan. Body: { recipes: [{ title, ingredients[], steps[], description?, ... }] }.
router.post('/bulk', requireAuth, (req, res) => {
  const drafts = Array.isArray(req.body?.recipes) ? req.body.recipes : [];
  if (drafts.length === 0) return res.status(400).json({ error: 'No recipes provided' });
  if (drafts.length > 50) return res.status(400).json({ error: 'Up to 50 recipes at a time' });

  const insert = db.prepare(
    `INSERT INTO recipes (user_id, title, slug, description, prep_min, cook_min, servings, ingredients, steps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const created = [];
  const createMany = db.transaction((items) => {
    for (const d of items) {
      const title = (d.title ?? '').trim();
      if (!title) continue; // skip untitled
      const info = insert.run(
        req.user.id,
        title,
        slugify(title),
        (d.description ?? '').trim(),
        d.prep_min || null,
        d.cook_min || null,
        d.servings || null,
        JSON.stringify(cleanLines(d.ingredients)),
        JSON.stringify(cleanLines(d.steps))
      );
      if (d.tags) setTags(info.lastInsertRowid, d.tags);
      created.push(info.lastInsertRowid);
    }
  });
  createMany(drafts);
  res.status(201).json({ created: created.length, ids: created });
});

// Read an image's raw bytes from wherever it lives (local disk, or the owner's Drive).
async function readImageBytes(img, ownerId) {
  if (img.storage === 'drive' && img.drive_file_id) {
    const { contentType, body } = await downloadFile(ownerId, img.drive_file_id);
    const chunks = [];
    for await (const c of Readable.fromWeb(body)) chunks.push(c);
    return { buffer: Buffer.concat(chunks), mimeType: contentType || 'image/jpeg' };
  }
  if (img.storage === 'local' && img.local_filename) {
    const buffer = fs.readFileSync(path.join(UPLOADS_DIR, img.local_filename));
    const ext = path.extname(img.local_filename).toLowerCase();
    const mimeType = Object.keys(MIME_EXT).find((m) => MIME_EXT[m] === ext) || 'image/jpeg';
    return { buffer, mimeType };
  }
  return null;
}

// POST /api/recipes/:id/copy — clone a recipe the caller can view into their own
// collection as a new private recipe (photos included, with attribution).
router.post('/:id/copy', requireAuth, async (req, res) => {
  const src = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id);
  if (!src) return res.status(404).json({ error: 'Recipe not found' });
  const canView = !!src.is_published || src.user_id === req.user.id || isCollaborator(src.id, req.user.id);
  if (!canView) return res.status(403).json({ error: 'You can only copy recipes you can view' });

  const author = db.prepare('SELECT display_name FROM users WHERE id = ?').get(src.user_id);
  const credit = author && src.user_id !== req.user.id ? `Adapted from ${author.display_name}.` : '';
  const description = [credit, src.description].filter(Boolean).join('\n\n');

  const newId = db
    .prepare(
      `INSERT INTO recipes (user_id, title, slug, description, prep_min, cook_min, servings, ingredients, steps)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, src.title, slugify(src.title), description, src.prep_min, src.cook_min, src.servings, src.ingredients, src.steps)
    .lastInsertRowid;

  const tagNames = db
    .prepare('SELECT t.name FROM tags t JOIN recipe_tags rt ON rt.tag_id = t.id WHERE rt.recipe_id = ?')
    .all(src.id).map((t) => t.name);
  if (tagNames.length) setTags(newId, tagNames);

  // Copy photos into the caller's storage (best-effort), preserving step/sort + cover.
  const linked = !!getLinkedAccount(req.user.id);
  const srcImages = db.prepare('SELECT * FROM recipe_images WHERE recipe_id = ? ORDER BY sort_order, id').all(src.id);
  let newCoverId = null;
  for (const img of srcImages) {
    try {
      const data = await readImageBytes(img, src.user_id);
      if (!data) continue;
      const ext = MIME_EXT[data.mimeType] || '.jpg';
      let newImgId;
      if (linked) {
        const fileId = await uploadFile(req.user.id, { buffer: data.buffer, mimeType: data.mimeType, name: `recipe-${newId}-${Date.now()}${ext}` });
        newImgId = db.prepare('INSERT INTO recipe_images (recipe_id, storage, drive_file_id, step_index, sort_order) VALUES (?, ?, ?, ?, ?)')
          .run(newId, 'drive', fileId, img.step_index, img.sort_order).lastInsertRowid;
      } else {
        const filename = `${crypto.randomUUID()}${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), data.buffer);
        newImgId = db.prepare('INSERT INTO recipe_images (recipe_id, storage, local_filename, step_index, sort_order) VALUES (?, ?, ?, ?, ?)')
          .run(newId, 'local', filename, img.step_index, img.sort_order).lastInsertRowid;
      }
      if (src.cover_image_id === img.id) newCoverId = newImgId;
    } catch (e) {
      console.error('Copy image failed:', e.message);
    }
  }
  if (newCoverId) db.prepare('UPDATE recipes SET cover_image_id = ? WHERE id = ?').run(newCoverId, newId);

  res.status(201).json({ recipe: hydrate(db.prepare('SELECT * FROM recipes WHERE id = ?').get(newId)) });
});

// Ownership guard — owner only (publish, delete, manage collaborators).
function loadOwnedRecipe(req, res) {
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Recipe not found' });
    return null;
  }
  if (row.user_id !== req.user.id) {
    res.status(403).json({ error: 'Only the recipe owner can do that' });
    return null;
  }
  return row;
}

// Edit guard — owner OR a collaborator (content edits: text, steps, photos, cover).
function loadEditableRecipe(req, res) {
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Recipe not found' });
    return null;
  }
  if (row.user_id !== req.user.id && !isCollaborator(row.id, req.user.id)) {
    res.status(403).json({ error: 'You do not have edit access to this recipe' });
    return null;
  }
  return row;
}

// Used by other routers (images) to authorize content edits.
function canEditRecipe(recipeId, userId) {
  const r = db.prepare('SELECT user_id FROM recipes WHERE id = ?').get(recipeId);
  if (!r) return false;
  return r.user_id === userId || isCollaborator(recipeId, userId);
}

// PUT /api/recipes/:id — update (owner or collaborator).
router.put('/:id', requireAuth, (req, res) => {
  const row = loadEditableRecipe(req, res);
  if (!row) return;
  const { title, description, prep_min, cook_min, servings, ingredients, steps, tags } = req.body ?? {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });

  db.prepare(
    `UPDATE recipes SET title = ?, slug = ?, description = ?, prep_min = ?, cook_min = ?,
       servings = ?, ingredients = ?, steps = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    title.trim(),
    slugify(title),
    (description ?? '').trim(),
    prep_min || null,
    cook_min || null,
    servings || null,
    JSON.stringify(cleanLines(ingredients)),
    JSON.stringify(cleanLines(steps)),
    row.id
  );
  if (tags !== undefined) setTags(row.id, tags);

  res.json({ recipe: hydrate(db.prepare('SELECT * FROM recipes WHERE id = ?').get(row.id)) });
});

// PATCH /api/recipes/:id/publish — toggle published state.
router.patch('/:id/publish', requireAuth, (req, res) => {
  const row = loadOwnedRecipe(req, res);
  if (!row) return;
  const publish = req.body?.is_published ? 1 : 0;
  db.prepare("UPDATE recipes SET is_published = ?, updated_at = datetime('now') WHERE id = ?").run(publish, row.id);
  res.json({ recipe: hydrate(db.prepare('SELECT * FROM recipes WHERE id = ?').get(row.id)) });
});

// PATCH /api/recipes/:id/cover — choose which uploaded image is the cover (owner or collaborator).
router.patch('/:id/cover', requireAuth, (req, res) => {
  const row = loadEditableRecipe(req, res);
  if (!row) return;
  const imageId = req.body?.image_id ?? null;
  if (imageId !== null) {
    const img = db.prepare('SELECT id FROM recipe_images WHERE id = ? AND recipe_id = ?').get(imageId, row.id);
    if (!img) return res.status(400).json({ error: 'That image is not on this recipe' });
  }
  db.prepare("UPDATE recipes SET cover_image_id = ?, updated_at = datetime('now') WHERE id = ?").run(imageId, row.id);
  res.json({ recipe: hydrate(db.prepare('SELECT * FROM recipes WHERE id = ?').get(row.id)) });
});

// DELETE /api/recipes/:id
router.delete('/:id', requireAuth, (req, res) => {
  const row = loadOwnedRecipe(req, res);
  if (!row) return;
  db.prepare('DELETE FROM recipes WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// --- Collaborators (co-creators) — owner only manages them ---

// GET /api/recipes/:id/collaborators
router.get('/:id/collaborators', requireAuth, (req, res) => {
  const row = loadOwnedRecipe(req, res);
  if (!row) return;
  const collaborators = db
    .prepare(
      `SELECT u.id, u.email, u.display_name FROM recipe_collaborators rc
       JOIN users u ON u.id = rc.user_id WHERE rc.recipe_id = ? ORDER BY u.display_name`
    )
    .all(row.id);
  res.json({ collaborators });
});

// POST /api/recipes/:id/collaborators { email } — share with an existing account.
router.post('/:id/collaborators', requireAuth, (req, res) => {
  const row = loadOwnedRecipe(req, res);
  if (!row) return;
  const email = (req.body?.email ?? '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const user = db.prepare('SELECT id, email, display_name FROM users WHERE email = ?').get(email);
  if (!user) return res.status(404).json({ error: 'No account with that email on this instance' });
  if (user.id === row.user_id) return res.status(400).json({ error: 'You already own this recipe' });
  db.prepare('INSERT OR IGNORE INTO recipe_collaborators (recipe_id, user_id) VALUES (?, ?)').run(row.id, user.id);
  res.status(201).json({ collaborator: { id: user.id, email: user.email, display_name: user.display_name } });
});

// DELETE /api/recipes/:id/collaborators/:userId
router.delete('/:id/collaborators/:userId', requireAuth, (req, res) => {
  const row = loadOwnedRecipe(req, res);
  if (!row) return;
  db.prepare('DELETE FROM recipe_collaborators WHERE recipe_id = ? AND user_id = ?').run(row.id, req.params.userId);
  res.json({ ok: true });
});

export default router;
export { hydrate, loadOwnedRecipe, canEditRecipe };
