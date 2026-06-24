import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// Snap → read → review. Uploads a photo of a recipe card, runs server-side OCR,
// then hands the best-guess draft to the editor for the user to correct + save.
export default function Import() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const { draft } = await api.upload('/import/ocr', file);
      // Pass the draft to the editor via router state (not saved yet).
      navigate('/new', { state: { draft } });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
    e.target.value = '';
  }

  return (
    <div className="auth-box card">
      <h1>Import from a photo</h1>
      <p className="muted">
        Take or upload a photo of a handwritten or printed recipe card. We'll read it
        and pre-fill the editor so you can tidy it up before saving.
      </p>

      {busy ? (
        <p style={{ marginTop: '1.5rem' }}>📖 Reading your recipe… this can take a few seconds.</p>
      ) : (
        <label className="btn" style={{ marginTop: '1rem', cursor: 'pointer' }}>
          Choose a photo
          <input type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
        </label>
      )}

      {error && <p className="error">{error}</p>}

      <p className="muted" style={{ fontSize: '0.85rem', marginTop: '1.5rem' }}>
        Tip: a flat, well-lit photo with clear text reads best. Nothing is saved until
        you review and hit Save.
      </p>
    </div>
  );
}
