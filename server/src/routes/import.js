import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWorker } from 'tesseract.js';
import { requireAuth } from '../auth.js';
import { DATA_DIR } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESSDATA = path.join(__dirname, '..', 'tessdata'); // bundled eng.traineddata.gz

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// One shared Tesseract worker, created lazily. Language data is read from the
// bundled tessdata dir (no runtime download) and cached in the data volume.
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      langPath: TESSDATA,
      cachePath: DATA_DIR,
      gzip: true,
    });
  }
  return workerPromise;
}

// Serialize OCR jobs — a single worker handles one image at a time.
let chain = Promise.resolve();
function recognize(buffer) {
  const run = chain.then(async () => {
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer);
    return data.text;
  });
  chain = run.catch(() => {}); // keep the chain alive even if one job fails
  return run;
}

const QTY = /(\d|½|¼|¾|⅓|⅔|⅛|\bcups?\b|\btsp\b|\btbsp\b|\btablespoons?\b|\bteaspoons?\b|\boz\b|\bounces?\b|\bgrams?\b|\bml\b|\blbs?\b|\bpounds?\b|\bpinch\b|\bcloves?\b|\bsticks?\b)/i;

// Turn raw OCR text into a best-guess recipe draft. Never authoritative — the user
// reviews and fixes everything in the editor before saving.
function parseRecipe(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { title: '', ingredients: [], steps: [], rawText: text };

  const title = lines[0];
  const body = lines.slice(1);

  const idxIng = body.findIndex((l) => /^ingredients\b/i.test(l));
  const idxSteps = body.findIndex((l) => /^(directions|steps|method|instructions|preparation)\b/i.test(l));

  let ingredients = [];
  let steps = [];
  if (idxIng !== -1 && idxSteps !== -1 && idxSteps > idxIng) {
    ingredients = body.slice(idxIng + 1, idxSteps);
    steps = body.slice(idxSteps + 1);
  } else if (idxSteps !== -1) {
    ingredients = body.slice(0, idxSteps).filter((l) => !/^ingredients\b/i.test(l));
    steps = body.slice(idxSteps + 1);
  } else if (idxIng !== -1) {
    ingredients = body.slice(idxIng + 1);
  } else {
    // No headers — guess by whether a line looks like a measured ingredient.
    for (const l of body) {
      if (QTY.test(l) && l.length < 60) ingredients.push(l);
      else steps.push(l);
    }
  }

  const stripBullet = (s) => s.replace(/^\s*\d+[.)]\s*/, '').replace(/^\s*[-•*]\s*/, '').trim();
  return {
    title,
    ingredients: ingredients.map(stripBullet).filter(Boolean),
    steps: steps.map(stripBullet).filter(Boolean),
    rawText: text,
  };
}

// --- Import from a recipe URL (parses schema.org/Recipe JSON-LD) ---

// Strip HTML tags / collapse whitespace from instruction text.
const clean = (s) => String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// Pull every JSON-LD blob out of the page and find the Recipe node.
function findRecipeNode(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const candidates = [];
  for (const m of blocks) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const queue = Array.isArray(data) ? [...data] : [data];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
      const type = node['@type'];
      const isRecipe = type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
      if (isRecipe) candidates.push(node);
    }
  }
  return candidates[0] || null;
}

// Normalize recipeInstructions into a flat string[] of steps.
function parseInstructions(instr) {
  if (!instr) return [];
  const out = [];
  const visit = (x) => {
    if (!x) return;
    if (typeof x === 'string') { out.push(clean(x)); return; }
    if (Array.isArray(x)) { x.forEach(visit); return; }
    if (x['@type'] === 'HowToSection' && x.itemListElement) { visit(x.itemListElement); return; }
    if (x.text) out.push(clean(x.text));
    else if (x.name) out.push(clean(x.name));
  };
  visit(instr);
  return out.filter(Boolean);
}

// POST /api/import/url — fetch + parse a recipe page into a draft. Does NOT save.
router.post('/url', requireAuth, async (req, res) => {
  const url = (req.body?.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Enter a valid http(s) URL' });
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DoughNotes/1.0)' },
      redirect: 'follow',
    });
    if (!resp.ok) return res.status(400).json({ error: `Couldn't fetch that page (${resp.status})` });
    const html = await resp.text();
    const node = findRecipeNode(html);
    if (!node) {
      return res.status(422).json({ error: "Couldn't find a recipe on that page. Try a different link or use the photo importer." });
    }
    const ingredients = []
      .concat(node.recipeIngredient || node.ingredients || [])
      .map(clean)
      .filter(Boolean);
    const draft = {
      title: clean(node.name || ''),
      ingredients,
      steps: parseInstructions(node.recipeInstructions),
      rawText: '',
    };
    res.json({ draft });
  } catch (e) {
    console.error('URL import error:', e.message);
    res.status(500).json({ error: 'Could not import from that URL' });
  }
});

// POST /api/import/ocr — read a photo of a recipe, return a draft. Does NOT save.
router.post('/ocr', requireAuth, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 25 MB or smaller' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    try {
      const text = await recognize(req.file.buffer);
      res.json({ draft: parseRecipe(text) });
    } catch (e) {
      console.error('OCR error:', e.message);
      res.status(500).json({ error: 'Could not read the image. Try a clearer, well-lit photo.' });
    }
  });
});

export default router;
