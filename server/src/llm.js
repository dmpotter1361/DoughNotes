// Optional AI recipe extraction via a local Ollama server. Fully private — nothing
// leaves the host. Disabled unless OLLAMA_URL is set; callers fall back to the
// heuristic parser when this is off or errors.

export function llmConfigured() {
  return !!process.env.OLLAMA_URL;
}

const MODEL = () => process.env.OLLAMA_MODEL || 'llama3.2:3b';
const TIMEOUT = () => Number(process.env.OLLAMA_TIMEOUT_MS) || 120000;

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

// Extract a recipe draft from free text using Ollama. Throws on any failure so the
// caller can fall back to the heuristic.
export async function llmExtract(text) {
  const base = process.env.OLLAMA_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL(),
      prompt: PROMPT(text),
      stream: false,
      format: 'json',
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(TIMEOUT()),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);

  const data = await res.json();
  const parsed = JSON.parse(data.response); // format:'json' guarantees valid JSON
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    title: String(parsed.title || '').trim(),
    ingredients: arr(parsed.ingredients).map((s) => String(s).trim()).filter(Boolean),
    steps: arr(parsed.steps).map((s) => String(s).trim()).filter(Boolean),
    rawText: text,
  };
}
