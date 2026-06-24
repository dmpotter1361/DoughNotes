// Scale the quantity at the start of an ingredient line by `factor`.
// Handles integers, decimals, ascii fractions (1/2), mixed numbers (1 1/2),
// unicode fractions (½), and ranges (2-3). Unparseable lines are returned as-is.

const UNICODE_FRACTIONS = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

// Render a number back as a nice fraction where possible (¼ steps), else rounded.
function pretty(n) {
  if (!isFinite(n)) return String(n);
  const rounded = Math.round(n * 100) / 100;
  const whole = Math.floor(rounded + 1e-9);
  const frac = rounded - whole;
  const eighths = Math.round(frac * 8);
  const glyphs = { 1: '⅛', 2: '¼', 3: '⅜', 4: '½', 5: '⅝', 6: '¾', 7: '⅞' };
  if (eighths === 0) return String(whole);
  if (eighths === 8) return String(whole + 1);
  const g = glyphs[eighths];
  if (g) return whole > 0 ? `${whole}${g}` : g;
  return String(rounded);
}

// Parse a leading quantity token; return [value, matchedText] or null.
function leadingQuantity(s) {
  const t = s.trimStart();

  // Unicode fraction, optionally with a leading whole number (e.g. "1½")
  let m = t.match(/^(\d+)?\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/);
  if (m) {
    const whole = m[1] ? parseInt(m[1], 10) : 0;
    return [whole + UNICODE_FRACTIONS[m[2]], m[0]];
  }
  // Mixed number "1 1/2"
  m = t.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (m) return [parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10), m[0]];
  // Simple fraction "1/2"
  m = t.match(/^(\d+)\/(\d+)/);
  if (m) return [parseInt(m[1], 10) / parseInt(m[2], 10), m[0]];
  // Decimal or integer "2" / "1.5"
  m = t.match(/^\d+(\.\d+)?/);
  if (m) return [parseFloat(m[0]), m[0]];
  return null;
}

export function scaleIngredient(line, factor) {
  if (factor === 1) return line;
  const trimmedStart = line.length - line.trimStart().length;
  const lead = line.slice(0, trimmedStart);
  let rest = line.trimStart();

  // Range like "2-3 cups" → scale both ends.
  const range = rest.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const a = pretty(parseFloat(range[1]) * factor);
    const b = pretty(parseFloat(range[2]) * factor);
    return lead + `${a}-${b}` + rest.slice(range[0].length);
  }

  const q = leadingQuantity(rest);
  if (!q) return line; // nothing to scale
  const [value, matched] = q;
  return lead + pretty(value * factor) + rest.slice(matched.length);
}

export function scaleIngredients(lines, factor) {
  return lines.map((l) => scaleIngredient(l, factor));
}
