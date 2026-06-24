import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const blank = {
  title: '', description: '', prep_min: '', cook_min: '', servings: '',
  ingredients: '', steps: '', tags: '',
};

// Multi-line textareas <-> arrays. One item per line.
const toLines = (arr) => (arr || []).join('\n');
const fromLines = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean);

export default function RecipeEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(blank);
  const [images, setImages] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) return;
    api.get(`/recipes/${id}`).then(({ recipe, is_owner }) => {
      if (!is_owner) { navigate(`/recipes/${id}`); return; }
      setForm({
        title: recipe.title,
        description: recipe.description,
        prep_min: recipe.prep_min ?? '',
        cook_min: recipe.cook_min ?? '',
        servings: recipe.servings ?? '',
        ingredients: toLines(recipe.ingredients),
        steps: toLines(recipe.steps),
        tags: (recipe.tags || []).join(', '),
      });
      setImages(recipe.images || []);
    }).catch((e) => setError(e.message));
  }, [id, editing, navigate]);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function payload() {
    return {
      title: form.title,
      description: form.description,
      prep_min: form.prep_min ? Number(form.prep_min) : null,
      cook_min: form.cook_min ? Number(form.cook_min) : null,
      servings: form.servings ? Number(form.servings) : null,
      ingredients: fromLines(form.ingredients),
      steps: fromLines(form.steps),
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    };
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (editing) {
        await api.put(`/recipes/${id}`, payload());
        navigate(`/recipes/${id}`);
      } else {
        const { recipe } = await api.post('/recipes', payload());
        navigate(`/recipes/${recipe.id}`);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function uploadImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const { image } = await api.upload(`/recipes/${id}/images`, file);
      setImages([...images, image]);
    } catch (err) {
      setError(err.message);
    }
    e.target.value = '';
  }

  async function removeImage(imgId) {
    await api.del(`/images/${imgId}`);
    setImages(images.filter((i) => i.id !== imgId));
  }

  return (
    <div className="card">
      <h1>{editing ? 'Edit Recipe' : 'New Recipe'}</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="title">Title</label>
        <input id="title" value={form.title} onChange={update('title')} required />

        <label htmlFor="desc">Description</label>
        <textarea id="desc" value={form.description} onChange={update('description')} />

        <div className="row">
          <div>
            <label htmlFor="prep">Prep (min)</label>
            <input id="prep" type="number" min="0" value={form.prep_min} onChange={update('prep_min')} />
          </div>
          <div>
            <label htmlFor="cook">Cook (min)</label>
            <input id="cook" type="number" min="0" value={form.cook_min} onChange={update('cook_min')} />
          </div>
          <div>
            <label htmlFor="serv">Servings</label>
            <input id="serv" type="number" min="0" value={form.servings} onChange={update('servings')} />
          </div>
        </div>

        <label htmlFor="ing">Ingredients <span className="muted">(one per line)</span></label>
        <textarea id="ing" rows="6" value={form.ingredients} onChange={update('ingredients')} />

        <label htmlFor="steps">Steps <span className="muted">(one per line)</span></label>
        <textarea id="steps" rows="6" value={form.steps} onChange={update('steps')} />

        <label htmlFor="tags">Tags <span className="muted">(comma separated)</span></label>
        <input id="tags" value={form.tags} onChange={update('tags')} placeholder="dessert, quick, vegetarian" />

        {error && <p className="error">{error}</p>}
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.6rem' }}>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Recipe'}</button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>

      {editing && (
        <div style={{ marginTop: '1.5rem' }}>
          <h2>Photos</h2>
          <p className="muted" style={{ fontSize: '0.85rem' }}>Max 1 MB each. Connect Drive for unlimited storage.</p>
          <div className="gallery">
            {images.map((img) => (
              <div key={img.id} style={{ position: 'relative' }}>
                <img src={img.url} alt="" />
                <button
                  className="danger no-print"
                  style={{ position: 'absolute', top: 4, right: 4, padding: '0.1rem 0.45rem' }}
                  onClick={() => removeImage(img.id)}
                >×</button>
              </div>
            ))}
          </div>
          <input type="file" accept="image/*" onChange={uploadImage} />
        </div>
      )}
    </div>
  );
}
