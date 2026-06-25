// Optional AI recipe extraction. Two backends, picked by which env vars are set:
//   - Gemini (hosted, free tier) when GEMINI_API_KEY is set — needs ~no server RAM.
//   - Ollama (local, private) when OLLAMA_URL is set — needs a few GB of RAM.
// Gemini wins if both are set. When neither is set, callers fall back to the heuristic.

export function llmProvider() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OLLAMA_URL) return 'ollama';
  return null;
}

export function llmConfigured() {
  return llmProvider() !== null;
}

const TIMEOUT = () => Number(process.env.LLM_TIMEOUT_MS) || 30000;

const PROMPT = (text) => `You turn messy text into a clean recipe. The text is often OCR
of a photo or a copy-pasted social-media post, so it may contain junk that is NOT part of
the recipe — ignore all of it:
- phone/app chrome: clock times (e.g. "10:50"), battery, "23h", view counts
- social UI: "Reply", "Like", "Share", "Comment as ...", reaction counts, usernames/handles
- calls to action: "Please like this comment", "Be sure to share this video", emojis

Extract the actual recipe and return ONLY JSON in exactly this shape:
{"title": string, "ingredients": [string], "steps": [string]}

Rules:
- "title" = the recipe's name (NOT a username, time, or heading like "RECIPE:").
- "ingredients" = one entry per ingredient, amount first when present (e.g. "2 cups flour").
- "steps" = the instructions in order, each a short imperative sentence.
- If the text is not a recipe, return {"title":"","ingredients":[],"steps":[]}.

TEXT:
${text}`;

function normalize(parsed, text) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    title: String(parsed.title || '').trim(),
    ingredients: arr(parsed.ingredients).map((s) => String(s).trim()).filter(Boolean),
    steps: arr(parsed.steps).map((s) => String(s).trim()).filter(Boolean),
    rawText: text,
  };
}

// --- Gemini (hosted) ---
async function geminiExtract(text) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const baseHost = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const url = `${baseHost}/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT(text) }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(TIMEOUT()),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!txt) throw new Error('Gemini returned no content');
  return normalize(JSON.parse(txt), text);
}

// --- Ollama (local) ---
async function ollamaExtract(text) {
  const base = process.env.OLLAMA_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || 'llama3.2:3b',
      prompt: PROMPT(text),
      stream: false,
      format: 'json',
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS) || 120000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  return normalize(JSON.parse(data.response), text);
}

// Extract a recipe draft from free text. Throws on failure so callers can fall back.
export async function llmExtract(text) {
  const provider = llmProvider();
  if (provider === 'gemini') return geminiExtract(text);
  if (provider === 'ollama') return ollamaExtract(text);
  throw new Error('No LLM configured');
}
