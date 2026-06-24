import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWorker } from 'tesseract.js';
import { getDocumentProxy } from 'unpdf';
import { requireAuth } from '../auth.js';
import { DATA_DIR } from '../db.js';
import { llmConfigured, llmExtract } from '../llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESSDATA = path.join(__dirname, '..', 'tessdata'); // bundled eng.traineddata.gz

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const uploadMany = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 25 } });

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

// App/phone/social-media chrome that isn't part of the recipe.
const JUNK = /^(\d{1,2}:\d{2}\b|\d+\s*[hdm]\b|reply\b|like\b|share\b|comment(\s+as)?\b|be sure to share|please like|view\b|\d+\s+(likes?|comments?|views?|replies)\b)/i;

// Turn raw OCR text into a best-guess recipe draft. Never authoritative — the user
// reviews and fixes everything in the editor before saving. (Used as the fallback when
// AI extraction is off/unavailable.)
function parseRecipe(text) {
  const lines = text.split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !JUNK.test(l) && !/^[\W_]+$/.test(l)); // drop chrome + symbol-only junk
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

// Preferred text→recipe path: use the local AI model when configured, otherwise fall
// back to the heuristic. Any AI failure logs and falls back, so imports never break.
async function extractRecipe(text) {
  if (llmConfigured()) {
    try {
      const draft = await llmExtract(text);
      if (draft.title || draft.ingredients.length || draft.steps.length) return draft;
    } catch (e) {
      console.error('AI extract failed, using heuristic:', e.message);
    }
  }
  return parseRecipe(text);
}

// --- Import from a recipe URL (parses schema.org/Recipe JSON-LD) ---

// Strip HTML tags / collapse whitespace from instruction text.
const clean = (s) => String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// BFS a parsed JSON value (object/array, incl. @graph) for a schema.org Recipe node.
function findRecipeInJson(value) {
  const queue = Array.isArray(value) ? [...value] : [value];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
    const type = node['@type'];
    const isRecipe = type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
    if (isRecipe) return node;
  }
  return null;
}

// Pull every JSON-LD blob out of an HTML page and find the Recipe node.
function findRecipeNode(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of blocks) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const node = findRecipeInJson(data);
    if (node) return node;
  }
  return null;
}

// Convert a schema.org Recipe node into our draft shape.
function recipeNodeToDraft(node) {
  return {
    title: clean(node.name || ''),
    ingredients: [].concat(node.recipeIngredient || node.ingredients || []).map(clean).filter(Boolean),
    steps: parseInstructions(node.recipeInstructions),
    rawText: '',
  };
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
    res.json({ draft: recipeNodeToDraft(node) });
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
      res.json({ draft: await extractRecipe(text) });
    } catch (e) {
      console.error('OCR error:', e.message);
      res.status(500).json({ error: 'Could not read the image. Try a clearer, well-lit photo.' });
    }
  });
});

// Extract text from a PDF while preserving line breaks — pdfjs text items carry an
// end-of-line flag (and a y-position fallback), which the heuristic parser needs.
async function extractPdfLines(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { items } = await page.getTextContent();
    let line = '';
    let lastY = null;
    for (const item of items) {
      const y = Math.round(item.transform?.[5] ?? 0);
      if (lastY !== null && Math.abs(y - lastY) > 2 && line.trim()) {
        lines.push(line.trim());
        line = '';
      }
      line += item.str;
      if (item.hasEOL) {
        if (line.trim()) lines.push(line.trim());
        line = '';
      }
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
  }
  return lines.join('\n');
}

// POST /api/import/pdf — extract embedded text from a PDF, return a draft. Does NOT save.
router.post('/pdf', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'PDF must be 25 MB or smaller' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    try {
      const text = await extractPdfLines(req.file.buffer);
      if (!text || text.trim().length < 20) {
        return res.status(422).json({ error: 'This PDF has no readable text (it may be scanned). Try the photo importer instead.' });
      }
      res.json({ draft: await extractRecipe(text) });
    } catch (e) {
      console.error('PDF import error:', e.message);
      res.status(500).json({ error: 'Could not read that PDF' });
    }
  });
});

// POST /api/import/text — parse pasted text or an uploaded .txt's contents. Does NOT save.
router.post('/text', requireAuth, async (req, res) => {
  const text = (req.body?.text ?? '').toString();
  if (!text.trim()) return res.status(400).json({ error: 'No text provided' });
  res.json({ draft: await extractRecipe(text) });
});

// POST /api/import/json — schema.org/Recipe JSON or a direct {title,ingredients,steps}.
router.post('/json', requireAuth, (req, res) => {
  let data = req.body?.data;
  if (data === undefined || data === null) return res.status(400).json({ error: 'No JSON provided' });
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return res.status(400).json({ error: 'That file is not valid JSON' }); }
  }
  const node = findRecipeInJson(data);
  if (node) return res.json({ draft: recipeNodeToDraft(node) });
  if (data && typeof data === 'object' && (Array.isArray(data.ingredients) || Array.isArray(data.steps))) {
    return res.json({
      draft: {
        title: clean(data.title || data.name || ''),
        ingredients: (data.ingredients || []).map(clean).filter(Boolean),
        steps: (data.steps || []).map((s) => clean(typeof s === 'string' ? s : (s.text || s.name || ''))).filter(Boolean),
        rawText: '',
      },
    });
  }
  res.status(422).json({ error: "Couldn't find a recipe in that JSON file." });
});

// --- Bulk / folder scan ---

// Turn a single uploaded file into a draft, routing by type. Throws on failure.
async function fileToDraft(buffer, mimetype, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const isPdf = mimetype === 'application/pdf' || ext === 'pdf';
  const isImage = (mimetype || '').startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
  const isJson = (mimetype || '').includes('json') || ext === 'json';
  const isText = (mimetype || '').startsWith('text/') || ['txt', 'md', 'text'].includes(ext);

  if (isPdf) {
    const text = await extractPdfLines(buffer);
    if (!text || text.trim().length < 20) throw new Error('No readable text (looks scanned)');
    return extractRecipe(text);
  }
  if (isJson) {
    let data;
    try { data = JSON.parse(buffer.toString('utf8')); } catch { throw new Error('Invalid JSON'); }
    const node = findRecipeInJson(data);
    if (node) return recipeNodeToDraft(node);
    if (data && typeof data === 'object' && (Array.isArray(data.ingredients) || Array.isArray(data.steps))) {
      return {
        title: clean(data.title || data.name || ''),
        ingredients: (data.ingredients || []).map(clean).filter(Boolean),
        steps: (data.steps || []).map((s) => clean(typeof s === 'string' ? s : (s.text || s.name || ''))).filter(Boolean),
        rawText: '',
      };
    }
    throw new Error('No recipe found in JSON');
  }
  if (isImage) {
    return extractRecipe(await recognize(buffer));
  }
  if (isText) {
    return extractRecipe(buffer.toString('utf8'));
  }
  throw new Error('Unsupported file type');
}

// POST /api/import/scan — process many files; return a draft + flag per file. No save.
router.post('/scan', requireAuth, (req, res) => {
  uploadMany.array('files', 25)(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 25 MB or smaller'
        : err.code === 'LIMIT_FILE_COUNT' ? 'Up to 25 files at a time'
        : err.message;
      return res.status(400).json({ error: msg });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    const results = [];
    for (const f of files) {
      try {
        const draft = await fileToDraft(f.buffer, f.mimetype, f.originalname);
        const looksLikeRecipe = !!(draft.title && (draft.ingredients.length || draft.steps.length));
        results.push({ filename: f.originalname, draft, looksLikeRecipe, error: null });
      } catch (e) {
        results.push({ filename: f.originalname, draft: null, looksLikeRecipe: false, error: e.message });
      }
    }
    res.json({ results });
  });
});

export default router;
