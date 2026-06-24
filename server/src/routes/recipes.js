import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth.js';
import { slugify, parseJson, cleanLines } from '../util.js';

const router = Router();

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
    rows = db
      .prepare(
        `SELECT * FROM recipes WHERE is_published = 1
         AND (title LIKE ? OR description LIKE ?)
         ORDER BY updated_at DESC`
      )
      .all(like, like);
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

// GET /api/recipes/:id — owner sees their own; anyone sees published.
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Recipe not found' });
  const isOwner = req.user && req.user.id === row.user_id;
  if (!row.is_published && !isOwner) return res.status(403).json({ error: 'This recipe is private' });
  res.json({ recipe: hydrate(row), is_owner: !!isOwner });
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

// Ownership guard for mutating a specific recipe.
function loadOwnedRecipe(req, res) {
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Recipe not found' });
    return null;
  }
  if (row.user_id !== req.user.id) {
    res.status(403).json({ error: 'You can only edit your own recipes' });
    return null;
  }
  return row;
}

// PUT /api/recipes/:id — update.
router.put('/:id', requireAuth, (req, res) => {
  const row = loadOwnedRecipe(req, res);
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

// PATCH /api/recipes/:id/cover — choose which uploaded image is the cover.
router.patch('/:id/cover', requireAuth, (req, res) => {
  const row = loadOwnedRecipe(req, res);
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

export default router;
export { hydrate, loadOwnedRecipe };
