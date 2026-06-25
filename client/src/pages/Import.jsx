import { useState, useEffect } from 'react';
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
  // Folder/bulk scan state
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState(null);   // [{ filename, draft, looksLikeRecipe, error, selected }]
  const [importing, setImporting] = useState(false);
  // Whether AI extraction is active (and which backend) — affects the labels/badge.
  const [aiOn, setAiOn] = useState(false);
  const [provider, setProvider] = useState(null);
  useEffect(() => {
    api.get('/import/config').then((d) => { setAiOn(!!d.ai); setProvider(d.provider); }).catch(() => {});
  }, []);
  const providerLabel = provider === 'gemini' ? 'Gemini' : provider === 'ollama' ? 'local AI' : 'AI';

  // Label shown while an AI-eligible source is processing.
  const reading = aiOn ? 'Reading with AI…' : 'Reading…';

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

  // --- Folder / bulk scan ---
  const SUPPORTED = ['pdf', 'txt', 'md', 'json', 'jpg', 'jpeg', 'png', 'webp', 'gif'];
  const MAX_FILES = 25;

  async function scanFiles(fileList) {
    setError('');
    let files = [...fileList].filter((f) => SUPPORTED.includes((f.name.split('.').pop() || '').toLowerCase()));
    if (files.length === 0) {
      setError('No supported files found (PDF, text, JSON, or images).');
      return;
    }
    let note = '';
    if (files.length > MAX_FILES) {
      note = ` (only the first ${MAX_FILES} of ${files.length} were scanned)`;
      files = files.slice(0, MAX_FILES);
    }
    setScanning(true);
    setResults(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append('files', f, f.name));
      const res = await fetch('/api/import/scan', { method: 'POST', credentials: 'include', body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Scan failed');
      setResults(data.results.map((r) => ({ ...r, selected: r.looksLikeRecipe })));
      if (note) setError('Scanned' + note);
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
    }
  }

  const onFolder = (e) => { const fs = e.target.files; e.target.value = ''; if (fs?.length) scanFiles(fs); };

  async function importSelected() {
    const recipes = results.filter((r) => r.selected && r.draft).map((r) => r.draft);
    if (recipes.length === 0) return;
    setImporting(true);
    setError('');
    try {
      const { created } = await api.post('/recipes/bulk', { recipes });
      navigate('/my', { state: { imported: created } });
    } catch (e) {
      setError(e.message);
      setImporting(false);
    }
  }

  const FileOption = ({ icon, title, desc, accept, capture, onChange, label, ai }) => (
    <label className="card import-option" style={{ cursor: 'pointer' }}>
      <input type="file" accept={accept} capture={capture} onChange={onChange} style={{ display: 'none' }} disabled={!!busy} />
      <div className="icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        <p className="muted">{busy === label ? (ai ? reading : 'Reading…') : desc}</p>
      </div>
    </label>
  );

  return (
    <div>
      <h1>Import a recipe</h1>
      <p className="muted">Bring a recipe in from a photo, file, link, or pasted text — we'll pre-fill the editor so you can tidy it up before saving.</p>
      <p style={{ fontSize: '0.9rem', color: aiOn ? 'var(--sage)' : 'var(--cocoa-soft)' }}>
        {aiOn
          ? `✨ AI-assisted import is on (${providerLabel}) — it cleans up messy photos and text for you.`
          : 'ℹ️ Using the built-in parser. Photo/PDF/text quality varies; an admin can enable AI for better results.'}
      </p>
      {error && <p className="error">{error}</p>}

      <div className="import-grid">
        <FileOption icon="📷" title="Photo" label="photo" ai desc="Snap or upload a recipe card (reads the text)"
          accept="image/*" capture="environment" onChange={onPhoto} />
        <FileOption icon="📄" title="PDF" label="pdf" ai desc="Upload a recipe PDF (text-based)"
          accept="application/pdf" onChange={onPdf} />
        <FileOption icon="📝" title="Text file" label="txt" ai desc="Upload a .txt recipe"
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
          <button type="submit" disabled={!!busy} style={{ marginTop: '0.5rem' }}>{busy === 'paste' ? reading : 'Import pasted text'}</button>
        </form>
      </div>

      <div className="card" style={{ marginTop: '1.2rem' }}>
        <h2 style={{ marginTop: 0 }}>🗂️ Scan a folder or many files</h2>
        <p className="muted">
          Pick a whole folder (desktop) or select multiple photos/files. We'll detect
          which ones look like recipes so you can bulk-import them. Up to {MAX_FILES} at a time.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <label className="btn secondary" style={{ cursor: 'pointer' }}>
            Choose files / photos
            <input type="file" multiple accept="image/*,application/pdf,.txt,.json" style={{ display: 'none' }} onChange={onFolder} disabled={scanning || importing} />
          </label>
          <label className="btn secondary" style={{ cursor: 'pointer' }}>
            Choose a folder
            <input type="file" webkitdirectory="" directory="" multiple style={{ display: 'none' }} onChange={onFolder} disabled={scanning || importing} />
          </label>
        </div>
        {scanning && <p style={{ marginTop: '0.8rem' }}>🔎 {aiOn ? 'Reading with AI' : 'Scanning'}… (images take a few seconds each{aiOn ? ', AI adds time' : ''})</p>}

        {results && (
          <div style={{ marginTop: '1rem' }}>
            <h3 style={{ marginBottom: '0.3rem' }}>
              {results.filter((r) => r.looksLikeRecipe).length} likely recipe(s) in {results.length} file(s)
            </h3>
            {results.map((r, i) => (
              <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.4rem 0', borderTop: '1px solid var(--line)', opacity: r.draft ? 1 : 0.6 }}>
                <input type="checkbox" checked={r.selected} disabled={!r.draft}
                  onChange={() => setResults((rs) => rs.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))}
                  style={{ width: 'auto' }} />
                <span style={{ flex: 1 }}>
                  <strong>{r.draft?.title || r.filename}</strong>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {r.draft ? ` — ${r.draft.ingredients.length} ingredients · ${r.draft.steps.length} steps` : ` — ${r.error || 'no recipe found'}`}
                    {` · ${r.filename}`}
                  </span>
                </span>
              </label>
            ))}
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <button onClick={importSelected} disabled={importing || results.every((r) => !r.selected)}>
                {importing ? 'Importing…' : `Import ${results.filter((r) => r.selected).length} selected`}
              </button>
              <button className="secondary" onClick={() => setResults(null)} disabled={importing}>Clear</button>
            </div>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Imported recipes are saved as private — edit or publish them anytime.
            </p>
          </div>
        )}
      </div>

      <p className="muted" style={{ fontSize: '0.85rem', marginTop: '1.5rem' }}>
        Tip: scanned/handwritten recipes read best as a clear, well-lit photo. Nothing is
        saved until you review and hit Save.
      </p>
    </div>
  );
}
