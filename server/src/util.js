// Turn a title into a URL-safe slug. Not unique on its own — recipes are always
// addressed by id; the slug is just for prettier URLs.
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'recipe';
}

// Safely parse a JSON column, falling back to a default.
export function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// Normalize an array of strings (ingredients / steps): trim, drop empties.
export function cleanLines(value) {
  if (!Array.isArray(value)) return [];
  return value.map((s) => String(s).trim()).filter(Boolean);
}
