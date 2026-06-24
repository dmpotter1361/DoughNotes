import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Private bake journal for a recipe — only ever shown to the owner.
export default function BakeLog({ recipeId }) {
  const [bakes, setBakes] = useState(null);
  const [form, setForm] = useState({ baked_at: new Date().toISOString().slice(0, 10), notes: '', outcome_rating: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/recipes/${recipeId}/bakes`).then((d) => setBakes(d.bakes)).catch((e) => setError(e.message));
  }, [recipeId]);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function addBake(e) {
    e.preventDefault();
    setError('');
    try {
      const { bake } = await api.post(`/recipes/${recipeId}/bakes`, {
        baked_at: form.baked_at,
        notes: form.notes,
        outcome_rating: form.outcome_rating ? Number(form.outcome_rating) : null,
      });
      setBakes([bake, ...bakes]);
      setForm({ ...form, notes: '', outcome_rating: '' });
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeBake(bakeId) {
    await api.del(`/bakes/${bakeId}`);
    setBakes(bakes.filter((b) => b.id !== bakeId));
  }

  const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—');

  return (
    <div className="card">
      <p className="muted">Your private bake log — notes on how each attempt turned out. Only you can see this.</p>

      <form onSubmit={addBake} style={{ marginBottom: '1.5rem' }}>
        <div className="row">
          <div>
            <label htmlFor="baked_at">Date</label>
            <input id="baked_at" type="date" value={form.baked_at} onChange={update('baked_at')} />
          </div>
          <div>
            <label htmlFor="rating">How did it turn out?</label>
            <select id="rating" value={form.outcome_rating} onChange={update('outcome_rating')}>
              <option value="">No rating</option>
              <option value="5">★★★★★ Perfect</option>
              <option value="4">★★★★ Great</option>
              <option value="3">★★★ Good</option>
              <option value="2">★★ Meh</option>
              <option value="1">★ Flop</option>
            </select>
          </div>
        </div>
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" value={form.notes} onChange={update('notes')} placeholder="What you changed, how it came out, what to try next time…" />
        {error && <p className="error">{error}</p>}
        <button type="submit" style={{ marginTop: '0.6rem' }}>Add bake entry</button>
      </form>

      {!bakes ? <p>Loading…</p> : bakes.length === 0 ? (
        <p className="muted">No bakes logged yet.</p>
      ) : (
        bakes.map((b) => (
          <div key={b.id} style={{ borderTop: '1px solid var(--line)', padding: '0.8rem 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{b.baked_at}</strong>
              <span>
                <span style={{ color: 'var(--crust)' }}>{stars(b.outcome_rating)}</span>{' '}
                <button className="danger" style={{ padding: '0.1rem 0.45rem' }} onClick={() => removeBake(b.id)}>×</button>
              </span>
            </div>
            {b.notes && <p style={{ margin: '0.4rem 0 0' }}>{b.notes}</p>}
          </div>
        ))
      )}
    </div>
  );
}
