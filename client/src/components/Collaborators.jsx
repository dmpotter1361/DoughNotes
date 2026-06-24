import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Owner-only panel to share a recipe with other accounts (co-creators: edit content only).
export default function Collaborators({ recipeId }) {
  const [list, setList] = useState(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/recipes/${recipeId}/collaborators`).then((d) => setList(d.collaborators)).catch((e) => setError(e.message));
  }, [recipeId]);

  async function add(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    try {
      const { collaborator } = await api.post(`/recipes/${recipeId}/collaborators`, { email });
      setList((prev) => [...prev.filter((c) => c.id !== collaborator.id), collaborator]);
      setEmail('');
    } catch (err) {
      setError(err.message);
    }
  }
  async function remove(userId) {
    await api.del(`/recipes/${recipeId}/collaborators/${userId}`);
    setList((prev) => prev.filter((c) => c.id !== userId));
  }

  return (
    <div className="card no-print" style={{ marginTop: '1.5rem' }}>
      <h2>Share / Co-creators</h2>
      <p className="muted" style={{ fontSize: '0.9rem' }}>
        Invite another DoughNotes account to help edit this recipe. They can change the
        content but can't publish, delete, or re-share it.
      </p>
      <form onSubmit={add} style={{ display: 'flex', gap: '0.5rem' }}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their account email" />
        <button type="submit">Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      {list && list.length > 0 && (
        <div style={{ marginTop: '0.8rem' }}>
          {list.map((c) => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderTop: '1px solid var(--line)' }}>
              <span>{c.display_name} <span className="muted">({c.email})</span></span>
              <button className="danger" style={{ padding: '0.05rem 0.45rem' }} onClick={() => remove(c.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
