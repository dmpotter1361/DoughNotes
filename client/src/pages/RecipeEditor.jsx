import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const blankForm = {
  title: '', description: '', prep_min: '', cook_min: '', servings: '', tags: '',
};

const toLines = (arr) => (arr || []).join('\n');
const fromLines = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean);

let tempCounter = 0;
const nextTempId = () => `q${++tempCounter}`;

// A photo (saved or queued) keyed for cover selection.
const keyOf = (photo) => (photo.id != null ? `s${photo.id}` : `q${photo.tempId}`);

export default function RecipeEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const draft = location.state?.draft;

  const [form, setForm] = useState(() => ({
    ...blankForm,
    ...(draft ? { title: draft.title || '' } : {}),
  }));
  const [ingredients, setIngredients] = useState(() => (draft ? toLines(draft.ingredients) : ''));
  const [steps, setSteps] = useState(() => (draft?.steps?.length ? draft.steps : ['']));
  // photos: each is { id, url, step_index } (saved) OR { tempId, file, url, step_index } (queued)
  const [photos, setPhotos] = useState([]);
  const [coverKey, setCoverKey] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) return;
    api.get(`/recipes/${id}`).then(({ recipe, is_owner, can_edit }) => {
      if (!is_owner && !can_edit) { navigate(`/recipes/${id}`); return; }
      setForm({
        title: recipe.title,
        description: recipe.description,
        prep_min: recipe.prep_min ?? '',
        cook_min: recipe.cook_min ?? '',
        servings: recipe.servings ?? '',
        tags: (recipe.tags || []).join(', '),
      });
      setIngredients(toLines(recipe.ingredients));
      setSteps(recipe.steps.length ? recipe.steps : ['']);
      setPhotos(recipe.images || []);
      if (recipe.cover_image_id) setCoverKey(`s${recipe.cover_image_id}`);
    }).catch((e) => setError(e.message));
  }, [id, editing, navigate]);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // --- Photo handling ---
  // Add a photo for a given step (null = general). Uploads now if editing; queues if new.
  async function addPhoto(stepIndex, file) {
    if (!file) return;
    setError('');
    if (editing) {
      try {
        const { image } = await api.upload(`/recipes/${id}/images`, file, { step_index: stepIndex });
        setPhotos((p) => [...p, { id: image.id, url: image.url, step_index: stepIndex }]);
      } catch (e) {
        setError(e.message);
      }
    } else {
      setPhotos((p) => [...p, { tempId: nextTempId(), file, url: URL.createObjectURL(file), step_index: stepIndex }]);
    }
  }

  async function removePhoto(photo) {
    if (photo.id != null) {
      await api.del(`/images/${photo.id}`);
    } else {
      URL.revokeObjectURL(photo.url);
    }
    setPhotos((p) => p.filter((x) => x !== photo));
    if (coverKey === keyOf(photo)) setCoverKey(null);
  }

  const photosForStep = (i) => photos.filter((p) => p.step_index === i);
  const generalPhotos = () => photos.filter((p) => p.step_index === null || p.step_index === undefined);

  // --- Steps ---
  const setStepText = (i, val) => setSteps(steps.map((s, idx) => (idx === i ? val : s)));
  const addStep = () => setSteps([...steps, '']);
  async function removeStep(i) {
    // Reassign/remove photos tied to steps so indices stay correct.
    for (const p of photos.filter((x) => x.step_index === i)) await removePhoto(p);
    // Shift later step photos down by one.
    for (const p of photos.filter((x) => typeof x.step_index === 'number' && x.step_index > i)) {
      if (p.id != null) await api.patch(`/images/${p.id}`, { step_index: p.step_index - 1 }).catch(() => {});
    }
    setPhotos((prev) => prev
      .filter((p) => p.step_index !== i)
      .map((p) => (typeof p.step_index === 'number' && p.step_index > i ? { ...p, step_index: p.step_index - 1 } : p)));
    setSteps(steps.filter((_, idx) => idx !== i));
  }

  function payload() {
    return {
      title: form.title,
      description: form.description,
      prep_min: form.prep_min ? Number(form.prep_min) : null,
      cook_min: form.cook_min ? Number(form.cook_min) : null,
      servings: form.servings ? Number(form.servings) : null,
      ingredients: fromLines(ingredients),
      steps: steps.map((s) => s.trim()).filter(Boolean),
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    };
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required'); return; }
    setError('');
    setBusy(true);
    try {
      let recipeId = id;
      if (editing) {
        await api.put(`/recipes/${id}`, payload());
      } else {
        const { recipe } = await api.post('/recipes', payload());
        recipeId = recipe.id;
        // Upload all queued photos, remembering which becomes the cover.
        let coverImageId = null;
        for (const p of photos) {
          const { image } = await api.upload(`/recipes/${recipeId}/images`, p.file, { step_index: p.step_index });
          if (coverKey === keyOf(p)) coverImageId = image.id;
        }
        if (coverImageId) await api.patch(`/recipes/${recipeId}/cover`, { image_id: coverImageId });
        navigate(`/recipes/${recipeId}`);
        return;
      }
      // Editing: cover refers to an already-saved image id.
      const coverId = coverKey?.startsWith('s') ? Number(coverKey.slice(1)) : null;
      await api.patch(`/recipes/${recipeId}/cover`, { image_id: coverId });
      navigate(`/recipes/${recipeId}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const sizeHint = user?.drive_linked
    ? 'Stored in your Google Drive (up to 20 MB each).'
    : 'Max 1 MB each. Connect Google Drive for larger photos.';

  // Thumbnail with cover toggle + remove.
  const Thumb = ({ photo }) => (
    <div style={{ position: 'relative' }}>
      <img src={photo.url} alt="" style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 8, border: coverKey === keyOf(photo) ? '3px solid var(--crust)' : '1px solid var(--line)' }} />
      <button type="button" className="danger" style={{ position: 'absolute', top: 4, right: 4, padding: '0.05rem 0.4rem' }} onClick={() => removePhoto(photo)}>×</button>
      <button
        type="button"
        title="Set as cover"
        onClick={() => setCoverKey(coverKey === keyOf(photo) ? null : keyOf(photo))}
        style={{ position: 'absolute', bottom: 4, left: 4, padding: '0.05rem 0.4rem', background: coverKey === keyOf(photo) ? 'var(--crust)' : 'rgba(0,0,0,0.5)' }}
      >★</button>
    </div>
  );

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
        <textarea id="ing" rows="6" value={ingredients} onChange={(e) => setIngredients(e.target.value)} />

        <label>Steps</label>
        <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>{sizeHint}</p>
        {steps.map((s, i) => (
          <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '0.7rem', marginBottom: '0.7rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
              <span style={{ fontWeight: 700, paddingTop: '0.55rem' }}>{i + 1}.</span>
              <textarea rows="2" value={s} onChange={(e) => setStepText(i, e.target.value)} placeholder={`Step ${i + 1}`} />
              <button type="button" className="danger" style={{ padding: '0.4rem 0.6rem' }} onClick={() => removeStep(i)}>×</button>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem', paddingLeft: '1.3rem' }}>
              {photosForStep(i).map((p) => <Thumb key={keyOf(p)} photo={p} />)}
              <label className="btn secondary" style={{ cursor: 'pointer', alignSelf: 'center' }}>
                + Step photo
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { addPhoto(i, e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>
          </div>
        ))}
        <button type="button" className="secondary" onClick={addStep}>+ Add step</button>

        <label htmlFor="tags" style={{ marginTop: '1.2rem' }}>Tags <span className="muted">(comma separated)</span></label>
        <input id="tags" value={form.tags} onChange={update('tags')} placeholder="dessert, quick, vegetarian" />

        {/* General photos */}
        <label style={{ marginTop: '1.2rem' }}>Photos <span className="muted">(★ marks the cover)</span></label>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {generalPhotos().map((p) => <Thumb key={keyOf(p)} photo={p} />)}
          <label className="btn secondary" style={{ cursor: 'pointer' }}>
            + Add photo
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { addPhoto(null, e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>

        {error && <p className="error" style={{ marginTop: '1rem' }}>{error}</p>}
        <div style={{ marginTop: '1.2rem', display: 'flex', gap: '0.6rem' }}>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Recipe'}</button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
