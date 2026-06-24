import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

// Star display/input. `value` is current stars; if `onRate` is given, stars are clickable.
function Stars({ value, onRate, size = '1.4rem' }) {
  const [hover, setHover] = useState(0);
  return (
    <span style={{ fontSize: size, color: 'var(--crust)', cursor: onRate ? 'pointer' : 'default', userSelect: 'none' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          onClick={onRate ? () => onRate(n) : undefined}
          onMouseEnter={onRate ? () => setHover(n) : undefined}
          onMouseLeave={onRate ? () => setHover(0) : undefined}
        >
          {(hover || value) >= n ? '★' : '☆'}
        </span>
      ))}
    </span>
  );
}

export default function RecipeSocial({ recipeId, isOwner }) {
  const { user } = useAuth();
  const [rating, setRating] = useState(null);
  const [comments, setComments] = useState(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/recipes/${recipeId}/rating`).then(setRating).catch(() => {});
    api.get(`/recipes/${recipeId}/comments`).then((d) => setComments(d.comments)).catch(() => {});
  }, [recipeId]);

  async function rate(stars) {
    setError('');
    try {
      setRating(await api.put(`/recipes/${recipeId}/rating`, { stars }));
    } catch (e) {
      setError(e.message);
    }
  }

  async function addComment(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setError('');
    try {
      const { comment } = await api.post(`/recipes/${recipeId}/comments`, { body });
      setComments([comment, ...comments]);
      setBody('');
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteComment(id) {
    await api.del(`/comments/${id}`);
    setComments(comments.filter((c) => c.id !== id));
  }

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      {/* Ratings */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <Stars value={Math.round(rating?.avg || 0)} />
          <span className="muted" style={{ marginLeft: '0.5rem' }}>
            {rating?.count ? `${rating.avg} (${rating.count} rating${rating.count === 1 ? '' : 's'})` : 'No ratings yet'}
          </span>
        </div>
        {user ? (
          <div style={{ marginLeft: 'auto' }}>
            <span className="muted" style={{ marginRight: '0.5rem' }}>Your rating:</span>
            <Stars value={rating?.my_rating || 0} onRate={rate} />
          </div>
        ) : (
          <span className="muted" style={{ marginLeft: 'auto' }}><Link to="/login">Log in</Link> to rate</span>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {/* Comments */}
      <h2 style={{ marginTop: '1.5rem' }}>Comments</h2>
      {user ? (
        <form onSubmit={addComment}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share a tip or how it turned out…" rows="3" />
          <button type="submit" style={{ marginTop: '0.5rem' }}>Post comment</button>
        </form>
      ) : (
        <p className="muted"><Link to="/login">Log in</Link> to leave a comment.</p>
      )}

      {!comments ? <p>Loading…</p> : comments.length === 0 ? (
        <p className="muted">No comments yet.</p>
      ) : (
        comments.map((c) => (
          <div key={c.id} style={{ borderTop: '1px solid var(--line)', padding: '0.7rem 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{c.author}</strong>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                {c.created_at.slice(0, 10)}
                {(user && (user.id === c.user_id || isOwner)) && (
                  <button className="danger" style={{ padding: '0.05rem 0.4rem', marginLeft: '0.5rem' }} onClick={() => deleteComment(c.id)}>×</button>
                )}
              </span>
            </div>
            <p style={{ margin: '0.3rem 0 0' }}>{c.body}</p>
          </div>
        ))
      )}
    </div>
  );
}
