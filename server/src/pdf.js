import PDFDocument from 'pdfkit';

// Cookbook palette (mirrors the web UI).
const COCOA = '#4a3526';
const CRUST = '#a8691c';
const SOFT = '#7a6450';

// Tiny seeded PRNG so a given `seed` always draws the same cover art.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draw a decorative cover page (double border + seeded scattered motif + title).
function drawCover(doc, { title, subtitle, seed }) {
  const W = doc.page.width;
  const H = doc.page.height;
  const rng = mulberry32(Math.floor(seed) || 1);
  doc.save();
  // double frame
  doc.lineWidth(3).strokeColor(CRUST).rect(30, 30, W - 60, H - 60).stroke();
  doc.lineWidth(1).strokeColor(SOFT).rect(40, 40, W - 80, H - 80).stroke();
  // seeded "confetti" of small dough crumbs near the top and bottom bands
  doc.fillColor(CRUST);
  for (let i = 0; i < 22; i++) {
    const x = 60 + rng() * (W - 120);
    const y = rng() < 0.5 ? 70 + rng() * 70 : H - 150 + rng() * 80;
    doc.circle(x, y, 1.5 + rng() * 3).fill();
  }
  // title block, roughly centered
  const ty = H / 2 - 90;
  doc.fillColor(COCOA).font('Times-Bold').fontSize(40).text(title, 60, ty, { width: W - 120, align: 'center' });
  doc.moveDown(0.6).fillColor(SOFT).font('Times-Italic').fontSize(14).text(subtitle, { width: W - 120, align: 'center' });
  doc.restore();
}

// Map a spec font family + style to one of pdfkit's built-in 14 fonts.
function pdfFont(family, bold, italic) {
  if (family === 'sans') {
    if (bold && italic) return 'Helvetica-BoldOblique';
    if (bold) return 'Helvetica-Bold';
    if (italic) return 'Helvetica-Oblique';
    return 'Helvetica';
  }
  if (family === 'mono') {
    if (bold && italic) return 'Courier-BoldOblique';
    if (bold) return 'Courier-Bold';
    if (italic) return 'Courier-Oblique';
    return 'Courier';
  }
  // serif (default)
  if (bold && italic) return 'Times-BoldItalic';
  if (bold) return 'Times-Bold';
  if (italic) return 'Times-Italic';
  return 'Times-Roman';
}

const dataUrlToBuffer = (s) => {
  const i = String(s).indexOf(',');
  return i === -1 ? null : Buffer.from(s.slice(i + 1), 'base64');
};

// Draw a cover from a saved editor spec (background + positioned text/image objects).
// All x/y/w/h are fractions of the page; font sizes are points.
function drawCoverFromSpec(doc, spec) {
  const W = doc.page.width;
  const H = doc.page.height;
  const bg = spec.background || {};
  doc.save();
  // background fill
  if (bg.color) doc.rect(0, 0, W, H).fill(bg.color);
  // full-page background photo (cover-fit, centered)
  if (bg.image) {
    const buf = dataUrlToBuffer(bg.image);
    if (buf) { try { doc.image(buf, 0, 0, { cover: [W, H], align: 'center', valign: 'center' }); } catch { /* skip bad image */ } }
  }
  // optional decorative frame + seeded confetti
  if (bg.style === 'frame') {
    const rng = mulberry32(Math.floor(bg.seed) || 1);
    doc.lineWidth(3).strokeColor(CRUST).rect(30, 30, W - 60, H - 60).stroke();
    doc.lineWidth(1).strokeColor(SOFT).rect(40, 40, W - 80, H - 80).stroke();
    doc.fillColor(CRUST);
    for (let i = 0; i < 22; i++) {
      const x = 60 + rng() * (W - 120);
      const y = rng() < 0.5 ? 70 + rng() * 70 : H - 150 + rng() * 80;
      doc.circle(x, y, 1.5 + rng() * 3).fill();
    }
  }
  // objects in order
  for (const o of spec.objects || []) {
    if (o.type === 'image' && o.data) {
      const buf = dataUrlToBuffer(o.data);
      if (buf) { try { doc.image(buf, o.x * W, o.y * H, { width: o.w * W, height: o.h * H }); } catch { /* skip */ } }
    } else if (o.type === 'text') {
      doc.fillColor(o.color || COCOA)
        .font(pdfFont(o.font, o.bold, o.italic))
        .fontSize(o.size || 24)
        .text(o.text || '', o.x * W, o.y * H, { width: o.w * W, align: o.align || 'left' });
    }
  }
  doc.restore();
}

// Render one or more recipes into a recipe-book PDF. Returns a Promise<Buffer>.
// `coverSpec` (a saved editor design) wins; else `subtitle`/`seed` drive the default cover.
export function buildRecipeBook({ title, subtitle, recipes, seed, coverSpec }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (coverSpec && Array.isArray(coverSpec.objects)) {
      drawCoverFromSpec(doc, coverSpec);
    } else {
      drawCover(doc, {
        title,
        subtitle: subtitle || `${recipes.length} recipe${recipes.length === 1 ? '' : 's'} · DoughNotes`,
        seed,
      });
    }

    recipes.forEach((r, i) => {
      doc.addPage();

      doc.fillColor(COCOA).font('Times-Bold').fontSize(24).text(r.title);
      if (r.author) {
        doc.moveDown(0.1).fillColor(SOFT).font('Times-Italic').fontSize(11).text(`by ${r.author}`);
      }
      if (r.description) {
        doc.moveDown(0.4).fillColor(COCOA).font('Times-Roman').fontSize(12).text(r.description);
      }

      const stats = [];
      if (r.prep_min) stats.push(`Prep ${r.prep_min} min`);
      if (r.cook_min) stats.push(`Cook ${r.cook_min} min`);
      if (r.servings) stats.push(`Serves ${r.servings}`);
      if (stats.length) {
        doc.moveDown(0.4).fillColor(CRUST).font('Times-Bold').fontSize(11).text(stats.join('   •   '));
      }

      if (r.ingredients?.length) {
        doc.moveDown(0.6).fillColor(CRUST).font('Times-Bold').fontSize(15).text('Ingredients');
        doc.moveDown(0.2).fillColor(COCOA).font('Times-Roman').fontSize(12);
        r.ingredients.forEach((ing) => doc.text(`•  ${ing}`));
      }

      if (r.steps?.length) {
        doc.moveDown(0.6).fillColor(CRUST).font('Times-Bold').fontSize(15).text('Steps');
        doc.moveDown(0.2).fillColor(COCOA).font('Times-Roman').fontSize(12);
        r.steps.forEach((s, idx) => {
          doc.text(`${idx + 1}.  ${s}`, { paragraphGap: 4 });
        });
      }

      if (r.tags?.length) {
        doc.moveDown(0.8).fillColor(SOFT).font('Times-Italic').fontSize(10).text(r.tags.map((t) => `#${t}`).join('  '));
      }
    });

    doc.end();
  });
}
