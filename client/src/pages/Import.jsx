import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// Import hub: several sources, all producing a draft that pre-fills the editor.
// Nothing is saved until the user reviews and hits Save.
export default function Import() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [pasted, setPasted] = useState('');

  function toEditor(draft) {
    navigate('/new', { state: { draft } });
  }
  async function run(label, fn) {
    setError('');
    setBusy(label);
    try {
      toEditor(await fn());
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  }

  // Photo (OCR)
  const onPhoto = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) run('photo', async () => (await api.upload('/import/ocr', file)).draft);
  };
  // PDF (text extraction)
  const onPdf = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) run('pdf', async () => (await api.upload('/import/pdf', file)).draft);
  };
  // Text file (.txt) — read locally, send contents
  const onTxt = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) run('txt', async () => {
      const text = await file.text();
      return (await api.post('/import/text', { text })).draft;
    });
  };
  // Recipe JSON — read locally, send parsed/raw
  const onJson = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) run('json', async () => {
      const data = await file.text();
      return (await api.post('/import/json', { data })).draft;
    });
  };
  // Paste text
  const onPaste = (e) => {
    e.preventDefault();
    if (pasted.trim()) run('paste', async () => (await api.post('/import/text', { text: pasted })).draft);
  };
  // URL
  const onUrl = (e) => {
    e.preventDefault();
    if (url.trim()) run('url', async () => (await api.post('/import/url', { url })).draft);
  };

  const FileOption = ({ icon, title, desc, accept, capture, onChange, label }) => (
    <label className="card import-option" style={{ cursor: 'pointer' }}>
      <input type="file" accept={accept} capture={capture} onChange={onChange} style={{ display: 'none' }} disabled={!!busy} />
      <div className="icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        <p className="muted">{busy === label ? 'Working…' : desc}</p>
      </div>
    </label>
  );

  return (
    <div>
      <h1>Import a recipe</h1>
      <p className="muted">Bring a recipe in from a photo, file, link, or pasted text — we'll pre-fill the editor so you can tidy it up before saving.</p>
      {error && <p className="error">{error}</p>}

      <div className="import-grid">
        <FileOption icon="📷" title="Photo" label="photo" desc="Snap or upload a recipe card (reads the text)"
          accept="image/*" capture="environment" onChange={onPhoto} />
        <FileOption icon="📄" title="PDF" label="pdf" desc="Upload a recipe PDF (text-based)"
          accept="application/pdf" onChange={onPdf} />
        <FileOption icon="📝" title="Text file" label="txt" desc="Upload a .txt recipe"
          accept=".txt,text/plain" onChange={onTxt} />
        <FileOption icon="🧾" title="Recipe JSON" label="json" desc="A schema.org or exported recipe file"
          accept=".json,application/json" onChange={onJson} />
      </div>

      <div className="card" style={{ marginTop: '1.2rem' }}>
        <h2 style={{ marginTop: 0 }}>🔗 From a link</h2>
        <form onSubmit={onUrl} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input type="url" placeholder="https://example.com/best-banana-bread" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <button type="submit" disabled={!!busy}>{busy === 'url' ? 'Importing…' : 'Import'}</button>
        </form>
      </div>

      <div className="card" style={{ marginTop: '1.2rem' }}>
        <h2 style={{ marginTop: 0 }}>📋 Paste text</h2>
        <form onSubmit={onPaste}>
          <textarea rows="6" placeholder={'Paste a recipe here…\n\nGrandma\'s Pancakes\nIngredients\n2 cups flour\n…'} value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <button type="submit" disabled={!!busy} style={{ marginTop: '0.5rem' }}>{busy === 'paste' ? 'Importing…' : 'Import pasted text'}</button>
        </form>
      </div>

      <p className="muted" style={{ fontSize: '0.85rem', marginTop: '1.5rem' }}>
        Tip: scanned/handwritten recipes read best as a clear, well-lit photo. Nothing is
        saved until you review and hit Save.
      </p>
    </div>
  );
}
