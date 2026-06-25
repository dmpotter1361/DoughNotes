import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import RecipeCard from '../components/RecipeCard.jsx';

export default function MyRecipes() {
  const [recipes, setRecipes] = useState(null);
  const [shared, setShared] = useState([]);
  const [error, setError] = useState('');
  // Cookbook builder
  const [bookTitle, setBookTitle] = useState('My Cookbook');
  const [bookScope, setBookScope] = useState('all');
  const [bookSeed, setBookSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [driveLinked, setDriveLinked] = useState(false);
  const [bookMsg, setBookMsg] = useState('');
  const [bookBusy, setBookBusy] = useState(false);

  useEffect(() => {
    api.get('/recipes/mine').then((d) => setRecipes(d.recipes)).catch((e) => setError(e.message));
    api.get('/recipes/shared').then((d) => setShared(d.recipes)).catch(() => {});
    api.get('/drive/status').then((d) => setDriveLinked(!!d.linked)).catch(() => {});
  }, []);

  const cookbookHref = `/api/cookbook.pdf?title=${encodeURIComponent(bookTitle || 'My Cookbook')}&scope=${bookScope}&seed=${bookSeed}`;

  async function saveCookbookToDrive() {
    setBookMsg('');
    setBookBusy(true);
    try {
      const { link } = await api.post('/drive/export/cookbook', { title: bookTitle, scope: bookScope, seed: bookSeed });
      setBookMsg(`Saved to Drive — `);
      window.open(link, '_blank', 'noopener');
    } catch (e) {
      setBookMsg(e.message);
    } finally {
      setBookBusy(false);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!recipes) return <p>Loading…</p>;

  return (
    <div>
      <div className="recipe-header">
        <h1>My Recipes</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link to="/import" className="btn secondary">📥 Import</Link>
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

      {recipes.length > 0 && (
        <div className="card" style={{ marginTop: '2rem' }}>
          <h2 style={{ marginTop: 0 }}>📖 Create a cookbook</h2>
          <p className="muted">Bundle your recipes into one PDF with a decorated cover.</p>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div>
              <label>Book name</label>
              <input value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="My Cookbook" />
            </div>
            <div>
              <label>Include</label>
              <select value={bookScope} onChange={(e) => setBookScope(e.target.value)}>
                <option value="all">All my recipes</option>
                <option value="published">Only published</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem', alignItems: 'center' }}>
            <a className="btn" href={cookbookHref}>⬇️ Download PDF</a>
            {driveLinked && (
              <button className="secondary" onClick={saveCookbookToDrive} disabled={bookBusy}>
                {bookBusy ? 'Saving…' : '☁️ Save to Drive'}
              </button>
            )}
            <button className="secondary" type="button" onClick={() => setBookSeed(Math.floor(Math.random() * 1e9))}>🎲 Shuffle art</button>
          </div>
          {bookMsg && <p className="muted" style={{ marginTop: '0.6rem' }}>{bookMsg}</p>}
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
