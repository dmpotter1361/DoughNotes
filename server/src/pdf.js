import PDFDocument from 'pdfkit';

// Cookbook palette (mirrors the web UI).
const COCOA = '#4a3526';
const CRUST = '#a8691c';
const SOFT = '#7a6450';

// Render one or more recipes into a recipe-book PDF. Returns a Promise<Buffer>.
export function buildRecipeBook({ title, recipes }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Cover
    doc.fillColor(CRUST).fontSize(34).font('Times-Bold').text(title, { align: 'center' });
    doc.moveDown(0.3);
    doc.fillColor(SOFT).fontSize(13).font('Times-Italic')
      .text(`${recipes.length} recipe${recipes.length === 1 ? '' : 's'} · DoughNotes`, { align: 'center' });

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
