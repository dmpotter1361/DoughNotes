import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import RecipeCard from '../components/RecipeCard.jsx';

export default function PublicFeed() {
  const { user } = useAuth();
  const [recipes, setRecipes] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  // Debounced search against the public feed.
  useEffect(() => {
    const t = setTimeout(() => {
      const path = query.trim() ? `/recipes/public?q=${encodeURIComponent(query.trim())}` : '/recipes/public';
      api.get(path).then((d) => setRecipes(d.recipes)).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div>
      <div className="recipe-header">
        <div>
          <h1>Community Recipes</h1>
          <p className="muted">Browse recipes shared by the DoughNotes community.</p>
        </div>
      </div>

      <input
        type="search"
        placeholder="Search recipes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ maxWidth: 360, marginBottom: '1.5rem' }}
      />

      {error && <p className="error">{error}</p>}
      {!recipes ? (
        <p>Loading…</p>
      ) : recipes.length === 0 ? (
        <p className="muted">
          {query ? 'No recipes match your search.' : 'No published recipes yet.'}
          {!user && ' '}
          {!user && !query && <>Be the first — <a href="/register">sign up</a> and share one.</>}
        </p>
      ) : (
        <div className="recipe-grid">
          {recipes.map((r) => <RecipeCard key={r.id} recipe={r} />)}
        </div>
      )}
    </div>
  );
}
