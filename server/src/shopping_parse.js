// Parse ingredient lines into a structured { qty, unit, name } so the shopping list
// can SUM duplicates (instead of skipping them), convert/annotate small cooking units
// into store-friendly ones, and group items by store section.
//
// Storage model (one row per merged item):
//   qty   = amount in the family's BASE unit (volume→tsp, weight→g, count→the count)
//   unit  = base-unit token: 'tsp' (volume) | 'g' (weight) | a count word | '' (bare count) | null (free text)
//   name  = normalized merge key (lowercased, singularized, pre-comma)
//   label = the human display string, rebuilt from the above on every change
// Two rows merge when they share the same (name, unit).

const UNICODE_FRACTIONS = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

// unit word (singular & plural folded) → { base, toBase } where base is the family token.
// Volume base = tsp; weight base = g; count words keep their own word as the base.
const VOLUME = {
  tsp: 1, teaspoon: 1, teaspoons: 1,
  tbsp: 3, tbl: 3, tablespoon: 3, tablespoons: 3,
  cup: 48, cups: 48,
  ml: 0.202884, milliliter: 0.202884, milliliters: 0.202884, millilitre: 0.202884, millilitres: 0.202884,
  l: 202.884, liter: 202.884, liters: 202.884, litre: 202.884, litres: 202.884,
  pt: 96, pint: 96, pints: 96,
  qt: 192, quart: 192, quarts: 192,
  gal: 768, gallon: 768, gallons: 768,
};
const FLOZ = { 'fl oz': 6, 'fluid ounce': 6, 'fluid ounces': 6 }; // two-word volume units
const WEIGHT = {
  g: 1, gram: 1, grams: 1,
  mg: 0.001, milligram: 0.001, milligrams: 0.001,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
  lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
};
// Count-type units keep their own word (so "2 cloves" + "1 clove" → "3 cloves").
const COUNT_UNITS = new Set([
  'clove', 'can', 'stick', 'package', 'pkg', 'slice', 'piece', 'bunch',
  'head', 'sprig', 'stalk', 'jar', 'bottle', 'bag', 'box', 'container', 'ear',
  // Kept as-is (you don't buy "pinches"); lossy to convert to tsp.
  'pinch', 'dash',
]);

function singular(w) {
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ses|shes|ches|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}
function plural(w, n) {
  if (Math.abs(n - 1) < 1e-9) return w;
  if (/(s|sh|ch|x|z)$/.test(w)) return w + 'es';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  return w + 's';
}

// Render a number as a tidy fraction (⅛ steps) where possible, else a short decimal.
export function prettyFrac(n) {
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
// Short decimal (for weights): trim trailing zeros.
function prettyDec(n) {
  return String(Math.round(n * 100) / 100);
}

// Parse a leading quantity from `s`; returns { value, len } or null. Ranges take the high end.
function leadingQuantity(s) {
  const t = s.trimStart();
  const lead = s.length - t.length;
  // Range "2-3" / "2 to 3" → high end
  let m = t.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/i);
  if (m) return { value: parseFloat(m[2]), len: lead + m[0].length };
  // Whole + unicode fraction "1½"
  m = t.match(/^(\d+)?\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/);
  if (m) return { value: (m[1] ? parseInt(m[1], 10) : 0) + UNICODE_FRACTIONS[m[2]], len: lead + m[0].length };
  // Mixed number "1 1/2"
  m = t.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (m) return { value: parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10), len: lead + m[0].length };
  // Simple fraction "1/2"
  m = t.match(/^(\d+)\/(\d+)/);
  if (m) return { value: parseInt(m[1], 10) / parseInt(m[2], 10), len: lead + m[0].length };
  // Decimal / integer
  m = t.match(/^\d+(?:\.\d+)?/);
  if (m) return { value: parseFloat(m[0]), len: lead + m[0].length };
  return null;
}

// Pull a unit off the front of `s`; returns { base, toBase, len, countWord } or null.
function leadingUnit(s) {
  const t = s.trimStart();
  const lead = s.length - t.length;
  const lower = t.toLowerCase();
  // two-word fluid-ounce first
  for (const k of Object.keys(FLOZ)) {
    if (lower.startsWith(k) && /\W|$/.test(lower[k.length] ?? '')) {
      return { base: 'tsp', toBase: FLOZ[k], len: lead + k.length };
    }
  }
  const wm = lower.match(/^([a-z]+)\.?/); // optional trailing period (e.g. "tbsp.")
  if (!wm) return null;
  const w = wm[1];
  if (VOLUME[w] != null) return { base: 'tsp', toBase: VOLUME[w], len: lead + wm[0].length };
  if (WEIGHT[w] != null) return { base: 'g', toBase: WEIGHT[w], len: lead + wm[0].length };
  const sw = singular(w);
  if (COUNT_UNITS.has(sw)) return { base: sw, toBase: 1, countWord: sw, len: lead + wm[0].length };
  return null;
}

// Normalize the ingredient name: drop parentheticals & anything after a comma,
// lowercase, collapse spaces. Returns { key, display }.
function normalizeName(s) {
  let name = s.replace(/\([^)]*\)/g, ' ').split(',')[0];
  name = name.replace(/\s+/g, ' ').trim().replace(/[.;:]+$/, '');
  const display = name.toLowerCase();
  const key = display.split(' ').map(singular).join(' ');
  return { key, display };
}

// Parse one ingredient line into a structured shopping entry.
// Returns { qty, unit, name, display, category, raw }. qty/unit are null for free text.
export function parseIngredient(line) {
  const raw = String(line).trim();
  // strip leading bullets / "1." numbering
  let rest = raw.replace(/^\s*\d+[.)]\s*/, '').replace(/^\s*[-•*]\s*/, '');
  const q = leadingQuantity(rest);
  if (!q) {
    const { key, display } = normalizeName(rest);
    return { qty: null, unit: null, name: key, display, category: categoryFor(key), raw };
  }
  rest = rest.slice(q.len);
  const u = leadingUnit(rest);
  let unit, qty;
  if (u) {
    rest = rest.slice(u.len);
    unit = u.base;
    qty = q.value * u.toBase;
  } else {
    unit = '';        // bare count, e.g. "3 eggs"
    qty = q.value;
  }
  const { key, display } = normalizeName(rest);
  if (!key) return { qty: null, unit: null, name: '', display: '', category: 'Other', raw };
  return { qty, unit, name: key, display, category: categoryFor(key), raw };
}

// Build the human display label for a merged item.
export function formatLabel({ qty, unit, display }) {
  if (qty == null) return display;
  if (unit === 'tsp') {
    let amount, uname;
    if (qty >= 48) { amount = qty / 48; uname = plural('cup', amount); }
    else if (qty >= 3) { amount = qty / 3; uname = 'tbsp'; }
    else { amount = qty; uname = 'tsp'; }
    const floz = qty / 6;
    const hint = floz >= 0.5 ? `≈ ${prettyDec(floz)} fl oz` : `≈ ${Math.round(qty * 4.92892)} ml`;
    return `${prettyFrac(amount)} ${uname} ${display} (${hint})`;
  }
  if (unit === 'g') {
    if (qty >= 453.592) return `${prettyDec(qty / 453.592)} lb ${display}`;
    if (qty >= 28.3495) return `${prettyDec(qty / 28.3495)} oz ${display}`;
    return `${prettyDec(qty)} g ${display} (≈ ${prettyDec(qty / 28.3495)} oz)`;
  }
  // count (with or without a count word)
  const word = unit ? plural(unit, qty) + ' ' : '';
  return `${prettyFrac(qty)} ${word}${display}`.replace(/\s+/g, ' ').trim();
}

// --- Store-section categorization (soft grouping; "Other" catches the rest) ---
// Checked in this order; first keyword hit wins.
const SECTIONS = [
  ['Meat & Seafood', ['chicken', 'beef', 'pork', 'bacon', 'sausage', 'turkey', 'ham', 'lamb',
    'steak', 'ground meat', 'mince', 'fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'crab',
    'lobster', 'cod', 'tilapia', 'chorizo', 'bratwurst', 'meatball']],
  ['Dairy & Eggs', ['milk', 'cream cheese', 'sour cream', 'heavy cream', 'cream', 'butter',
    'buttermilk', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'ricotta', 'yogurt', 'yoghurt',
    'egg', 'half-and-half', 'margarine']],
  ['Spices & Baking', ['black pepper', 'white pepper', 'peppercorn', 'salt', 'cinnamon', 'nutmeg',
    'cumin', 'paprika', 'oregano', 'chili powder', 'cayenne', 'turmeric', 'vanilla', 'almond extract',
    'extract', 'baking soda', 'baking powder', 'yeast', 'flour', 'sugar', 'cocoa', 'chocolate',
    'cornstarch', 'corn starch', 'food coloring', 'sprinkle', 'spice', 'seasoning', 'powdered sugar',
    'brown sugar', 'confectioner']],
  ['Produce', ['apple', 'banana', 'lemon', 'lime', 'orange', 'berry', 'strawberry', 'blueberry',
    'raspberry', 'grape', 'melon', 'peach', 'pear', 'plum', 'mango', 'avocado', 'tomato', 'potato',
    'onion', 'garlic', 'ginger', 'carrot', 'celery', 'bell pepper', 'red pepper', 'green pepper',
    'jalapeno', 'pepper', 'cucumber', 'lettuce', 'spinach', 'kale', 'broccoli', 'cauliflower',
    'cabbage', 'zucchini', 'squash', 'mushroom', 'corn', 'basil', 'cilantro', 'parsley', 'mint',
    'rosemary', 'thyme', 'scallion', 'shallot', 'leek', 'herb', 'fruit', 'vegetable']],
  ['Bakery', ['bread', 'baguette', 'bun', 'roll', 'tortilla', 'pita', 'bagel', 'croissant', 'dough']],
  ['Frozen', ['frozen', 'ice cream', 'ice']],
  ['Pantry', ['olive oil', 'vegetable oil', 'oil', 'vinegar', 'soy sauce', 'sauce', 'ketchup',
    'mustard', 'mayonnaise', 'mayo', 'honey', 'syrup', 'broth', 'stock', 'pasta', 'spaghetti',
    'noodle', 'rice', 'oats', 'oat', 'cereal', 'beans', 'lentil', 'chickpea', 'tomato paste',
    'peanut butter', 'jam', 'jelly', 'almond', 'walnut', 'pecan', 'raisin', 'coconut', 'cracker',
    'chip', 'water', 'can']],
];
export const SECTION_ORDER = ['Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Frozen', 'Pantry', 'Spices & Baking', 'Other'];

export function categoryFor(name) {
  const n = String(name || '').toLowerCase();
  for (const [section, words] of SECTIONS) {
    if (words.some((w) => n.includes(w))) return section;
  }
  return 'Other';
}

// Which display family a stored base unit belongs to (for grouping/merging).
export function unitFamily(unit) {
  if (unit === 'tsp') return 'volume';
  if (unit === 'g') return 'weight';
  return 'count';
}
