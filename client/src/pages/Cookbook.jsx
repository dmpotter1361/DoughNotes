import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

// A4 portrait, in points — the same coordinate system the server PDF uses.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const ASPECT = PAGE_H / PAGE_W;

// Map a spec font family to a CSS stack that resembles the PDF's built-in font.
const cssFont = (f) =>
  f === 'sans' ? 'Helvetica, Arial, sans-serif' : f === 'mono' ? '"Courier New", Courier, monospace' : '"Times New Roman", Times, serif';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function defaultSpec() {
  return {
    version: 1,
    background: { style: 'frame', color: '#faf3e7', seed: Math.floor(Math.random() * 1e9), image: null },
    objects: [
      { id: uid(), type: 'text', text: 'My Cookbook', x: 0.1, y: 0.34, w: 0.8, font: 'serif', size: 40, bold: true, italic: false, color: '#4a3526', align: 'center' },
      { id: uid(), type: 'text', text: 'by Your Name', x: 0.1, y: 0.47, w: 0.8, font: 'serif', size: 16, bold: false, italic: true, color: '#7a6450', align: 'center' },
      { id: uid(), type: 'text', text: 'First Edition · 2026', x: 0.1, y: 0.86, w: 0.8, font: 'serif', size: 12, bold: false, italic: false, color: '#7a6450', align: 'center' },
    ],
  };
}

// Downscale an image file to a JPEG data URL (max 1400px on the long edge).
function fileToDataUrl(file, max = 1400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.82), ratio: h / w });
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = URL.createObjectURL(file);
  });
}

export default function Cookbook() {
  const [spec, setSpec] = useState(null);
  const [selId, setSelId] = useState(null);
  const [scope, setScope] = useState('all');
  const [driveLinked, setDriveLinked] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [canvasW, setCanvasW] = useState(520);

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const gestureRef = useRef(null); // active drag/resize data

  useEffect(() => {
    api.get('/cookbook/cover').then((d) => setSpec(d.spec || defaultSpec())).catch(() => setSpec(defaultSpec()));
    api.get('/drive/status').then((d) => setDriveLinked(!!d.linked)).catch(() => {});
  }, []);

  // Track the canvas pixel width so points → px stays accurate on any screen.
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => setCanvasW(e.contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [spec]);

  if (!spec) return <div className="container"><p>Loading…</p></div>;

  const canvasH = canvasW * ASPECT;
  const scale = canvasW / PAGE_W; // points → px
  const sel = spec.objects.find((o) => o.id === selId) || null;

  const patchObj = (id, patch) =>
    setSpec((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
  const patchBg = (patch) => setSpec((s) => ({ ...s, background: { ...s.background, ...patch } }));

  // --- drag / resize gestures (pointer capture on the element) ---
  function startDrag(e, o) {
    e.stopPropagation();
    setSelId(o.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = canvasRef.current.getBoundingClientRect();
    gestureRef.current = { kind: 'drag', id: o.id, px: e.clientX, py: e.clientY, ox: o.x, oy: o.y, rect };
  }
  function startResize(e, o) {
    e.stopPropagation();
    setSelId(o.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = canvasRef.current.getBoundingClientRect();
    gestureRef.current = { kind: 'resize', id: o.id, px: e.clientX, ow: o.w, oh: o.h, ar: o.type === 'image' ? (o.h / o.w) : null, rect };
  }
  function onMove(e) {
    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === 'drag') {
      const dx = (e.clientX - g.px) / g.rect.width;
      const dy = (e.clientY - g.py) / g.rect.height;
      patchObj(g.id, { x: clamp(g.ox + dx, 0, 1), y: clamp(g.oy + dy, 0, 1) });
    } else {
      const dw = (e.clientX - g.px) / g.rect.width;
      const w = clamp(g.ow + dw, 0.05, 1);
      patchObj(g.id, g.ar ? { w, h: w * g.ar } : { w });
    }
  }
  const endGesture = () => { gestureRef.current = null; };

  // --- toolbar actions ---
  function addText() {
    const o = { id: uid(), type: 'text', text: 'New text', x: 0.2, y: 0.2, w: 0.6, font: 'serif', size: 20, bold: false, italic: false, color: '#4a3526', align: 'center' };
    setSpec((s) => ({ ...s, objects: [...s.objects, o] }));
    setSelId(o.id);
  }
  async function addImage(file) {
    if (!file) return;
    setMsg('');
    try {
      const { dataUrl, ratio } = await fileToDataUrl(file);
      // place at ~40% width, height preserves the image's pixel aspect on the page
      const w = 0.4;
      const h = w * ratio * (PAGE_W / PAGE_H);
      const o = { id: uid(), type: 'image', data: dataUrl, x: 0.3, y: 0.3, w, h };
      setSpec((s) => ({ ...s, objects: [...s.objects, o] }));
      setSelId(o.id);
    } catch (e) { setMsg(e.message); }
  }
  async function setBackgroundPhoto(file) {
    if (!file) return;
    setMsg('');
    try { const { dataUrl } = await fileToDataUrl(file, 1600); patchBg({ image: dataUrl }); }
    catch (e) { setMsg(e.message); }
  }
  const removeSel = () => { if (sel) { setSpec((s) => ({ ...s, objects: s.objects.filter((o) => o.id !== sel.id) })); setSelId(null); } }
  function reorderSel(dir) {
    if (!sel) return;
    setSpec((s) => {
      const arr = [...s.objects];
      const i = arr.findIndex((o) => o.id === sel.id);
      const j = dir === 'front' ? arr.length - 1 : 0;
      arr.splice(i, 1); arr.splice(j, 0, sel);
      return { ...s, objects: arr };
    });
  }

  async function saveCover() {
    setBusy(true); setMsg('');
    try { await api.put('/cookbook/cover', { spec }); setMsg('Cover saved.'); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }
  const titleText = (spec.objects.find((o) => o.type === 'text' && o.text.trim())?.text || 'My Cookbook').slice(0, 100);
  async function downloadPdf() {
    setBusy(true); setMsg('');
    try {
      await api.put('/cookbook/cover', { spec });
      window.location.href = `/api/cookbook.pdf?scope=${scope}&title=${encodeURIComponent(titleText)}&t=${Date.now()}`;
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function saveToDrive() {
    setBusy(true); setMsg('');
    try {
      await api.put('/cookbook/cover', { spec });
      const { link } = await api.post('/drive/export/cookbook', { title: titleText, scope });
      setMsg('Saved to Drive.');
      window.open(link, '_blank', 'noopener');
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  // background style for the canvas preview
  const bg = spec.background || {};
  const canvasBg = {
    width: '100%', aspectRatio: `${PAGE_W} / ${PAGE_H}`, position: 'relative',
    background: bg.color || '#faf3e7', borderRadius: 4, overflow: 'hidden',
    boxShadow: '0 2px 12px rgba(0,0,0,0.15)', userSelect: 'none', touchAction: 'none',
    ...(bg.image ? { backgroundImage: `url(${bg.image})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
  };

  return (
    <div>
      <div className="recipe-header">
        <h1>📖 Cookbook cover</h1>
        <Link to="/my" className="btn secondary">← My Recipes</Link>
      </div>
      <p className="muted">Design the cover, then download your whole recipe collection as one book. Tap an item to edit it; drag to move; drag the corner to resize.</p>
      {msg && <p className="muted">{msg}</p>}

      <div className="cookbook-layout">
        {/* Canvas */}
        <div ref={wrapRef} style={{ flex: '1 1 360px', minWidth: 280, maxWidth: 560 }}>
          <div
            ref={canvasRef}
            style={canvasBg}
            onPointerDown={() => setSelId(null)}
            onPointerMove={onMove}
            onPointerUp={endGesture}
          >
            {/* decorative frame preview */}
            {bg.style === 'frame' && (
              <div style={{ position: 'absolute', inset: `${30 * scale}px`, border: `${Math.max(1, 3 * scale)}px solid #a8691c`, pointerEvents: 'none' }}>
                <div style={{ position: 'absolute', inset: `${10 * scale}px`, border: `1px solid #7a6450` }} />
              </div>
            )}
            {spec.objects.map((o) => {
              const selected = o.id === selId;
              const common = {
                position: 'absolute', left: o.x * canvasW, top: o.y * canvasH, width: o.w * canvasW,
                cursor: 'move', outline: selected ? '2px solid #a8691c' : '1px dashed rgba(120,100,80,0.4)', outlineOffset: 2,
              };
              return (
                <div key={o.id} style={common} onPointerDown={(e) => startDrag(e, o)}>
                  {o.type === 'text' ? (
                    <div style={{ fontFamily: cssFont(o.font), fontSize: o.size * scale, fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal', color: o.color, textAlign: o.align, lineHeight: 1.15, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {o.text || ' '}
                    </div>
                  ) : (
                    <img src={o.data} alt="" draggable={false} style={{ width: '100%', height: o.h * canvasH, objectFit: 'fill', display: 'block' }} />
                  )}
                  {selected && (
                    <div
                      onPointerDown={(e) => startResize(e, o)}
                      style={{ position: 'absolute', right: -7, bottom: -7, width: 14, height: 14, background: '#a8691c', border: '2px solid #fff', borderRadius: 3, cursor: 'nwse-resize' }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Controls */}
        <div style={{ flex: '1 1 260px', minWidth: 240 }}>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <strong>Add</strong>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              <button className="secondary" onClick={addText}>➕ Text</button>
              <label className="btn secondary" style={{ cursor: 'pointer' }}>
                🖼 Image
                <input type="file" accept="image/*" className="visually-hidden" onChange={(e) => { addImage(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>
          </div>

          <div className="card" style={{ marginBottom: '1rem' }}>
            <strong>Background</strong>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem' }}>
              <select value={bg.style} onChange={(e) => patchBg({ style: e.target.value })} style={{ width: 'auto' }}>
                <option value="frame">Decorative frame</option>
                <option value="plain">Plain</option>
              </select>
              <input type="color" value={bg.color || '#faf3e7'} onChange={(e) => patchBg({ color: e.target.value })} title="Background color" style={{ width: 44, padding: 2 }} />
              <button className="secondary" onClick={() => patchBg({ seed: Math.floor(Math.random() * 1e9) })}>🎲 Shuffle art</button>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              <label className="btn secondary" style={{ cursor: 'pointer' }}>
                Set photo
                <input type="file" accept="image/*" className="visually-hidden" onChange={(e) => { setBackgroundPhoto(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {bg.image && <button className="secondary" onClick={() => patchBg({ image: null })}>Clear photo</button>}
            </div>
          </div>

          {sel ? (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <strong>{sel.type === 'text' ? 'Text' : 'Image'}</strong>
              {sel.type === 'text' && (
                <>
                  <textarea rows="2" value={sel.text} onChange={(e) => patchObj(sel.id, { text: e.target.value })} style={{ marginTop: '0.5rem' }} />
                  <div className="row" style={{ marginTop: '0.5rem' }}>
                    <div>
                      <label>Font</label>
                      <select value={sel.font} onChange={(e) => patchObj(sel.id, { font: e.target.value })}>
                        <option value="serif">Serif</option>
                        <option value="sans">Sans</option>
                        <option value="mono">Mono</option>
                      </select>
                    </div>
                    <div>
                      <label>Size</label>
                      <input type="number" min="6" max="120" value={sel.size} onChange={(e) => patchObj(sel.id, { size: clamp(Number(e.target.value) || 12, 6, 120) })} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.6rem' }}>
                    <button className={sel.bold ? '' : 'secondary'} onClick={() => patchObj(sel.id, { bold: !sel.bold })} style={{ fontWeight: 700 }}>B</button>
                    <button className={sel.italic ? '' : 'secondary'} onClick={() => patchObj(sel.id, { italic: !sel.italic })} style={{ fontStyle: 'italic' }}>I</button>
                    <input type="color" value={sel.color} onChange={(e) => patchObj(sel.id, { color: e.target.value })} title="Text color" style={{ width: 44, padding: 2 }} />
                    {['left', 'center', 'right'].map((a) => (
                      <button key={a} className={sel.align === a ? '' : 'secondary'} onClick={() => patchObj(sel.id, { align: a })}>{a[0].toUpperCase()}</button>
                    ))}
                  </div>
                </>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.7rem' }}>
                <button className="secondary" onClick={() => reorderSel('front')}>Bring front</button>
                <button className="secondary" onClick={() => reorderSel('back')}>Send back</button>
                <button className="danger" onClick={removeSel}>Delete</button>
              </div>
            </div>
          ) : (
            <p className="muted">Select an item on the cover to edit it.</p>
          )}

          <div className="card">
            <strong>Make the book</strong>
            <label style={{ marginTop: '0.4rem' }}>Include</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">All my recipes</option>
              <option value="published">Only published</option>
            </select>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
              <button onClick={saveCover} disabled={busy}>💾 Save cover</button>
              <button className="secondary" onClick={downloadPdf} disabled={busy}>⬇️ Download PDF</button>
              {driveLinked && <button className="secondary" onClick={saveToDrive} disabled={busy}>☁️ Save to Drive</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
