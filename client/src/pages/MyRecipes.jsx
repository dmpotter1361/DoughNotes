import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import RecipeCard from '../components/RecipeCard.jsx';

export default function MyRecipes() {
  const [recipes, setRecipes] = useState(null);
  const [shared, setShared] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/recipes/mine').then((d) => setRecipes(d.recipes)).catch((e) => setError(e.message));
    api.get('/recipes/shared').then((d) => setShared(d.recipes)).catch(() => {});
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!recipes) return <p>Loading…</p>;

  return (
    <div>
      <div className="recipe-header">
        <h1>My Recipes</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link to="/import" className="btn secondary">📷 Import from photo</Link>
          <Link to="/new" className="btn">+ New Recipe</Link>
        </div>
      </div>
      {recipes.length === 0 ? (
        <p className="muted">No recipes yet. <Link to="/new">Create your first one</Link> — it stays private until you publish it.</p>
      ) : (
        <div className="recipe-grid">
          {recipes.map((r) => (
            <div key={r.id} style={{ position: 'relative' }}>
              <RecipeCard recipe={r} />
              <span
                className={`pill ${r.is_published ? 'published' : 'private'}`}
                style={{ position: 'absolute', top: '0.6rem', right: '0.6rem' }}
              >
                {r.is_published ? 'Published' : 'Private'}
              </span>
            </div>
          ))}
        </div>
      )}

      {shared.length > 0 && (
        <>
          <h2 style={{ marginTop: '2rem' }}>Shared with me</h2>
          <p className="muted">Recipes others have invited you to help edit.</p>
          <div className="recipe-grid">
            {shared.map((r) => <RecipeCard key={r.id} recipe={r} />)}
          </div>
        </>
      )}
    </div>
  );
}
