import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import BakeLog from '../components/BakeLog.jsx';
import RecipeSocial from '../components/RecipeSocial.jsx';

export default function RecipeView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [recipe, setRecipe] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [tab, setTab] = useState('recipe');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/recipes/${id}`)
      .then(({ recipe, is_owner }) => { setRecipe(recipe); setIsOwner(is_owner); })
      .catch((e) => setError(e.message));
  }, [id]);

  async function togglePublish() {
    const { recipe: updated } = await api.patch(`/recipes/${id}/publish`, { is_published: !recipe.is_published });
    setRecipe(updated);
  }

  async function remove() {
    if (!confirm('Delete this recipe? This cannot be undone.')) return;
    await api.del(`/recipes/${id}`);
    navigate('/my');
  }

  async function saveToDrive() {
    try {
      const { link } = await api.post(`/drive/export/recipe/${id}`);
      window.open(link, '_blank');
    } catch (e) {
      alert(e.message);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!recipe) return <p>Loading…</p>;

  const totalMin = (recipe.prep_min || 0) + (recipe.cook_min || 0);

  return (
    <article>
      <div className="recipe-header">
        <div>
          <h1>{recipe.title}</h1>
          <p className="muted">by {recipe.author}</p>
        </div>
        {isOwner && (
          <div className="no-print" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="secondary" onClick={() => navigate(`/recipes/${id}/edit`)}>Edit</button>
            <button className="secondary" onClick={() => window.print()}>Print</button>
            {user?.drive_linked && <button className="secondary" onClick={saveToDrive}>Save PDF to Drive</button>}
            <button onClick={togglePublish}>{recipe.is_published ? 'Unpublish' : 'Publish'}</button>
            <button className="danger" onClick={remove}>Delete</button>
          </div>
        )}
        {!isOwner && (
          <button className="secondary no-print" onClick={() => window.print()}>Print</button>
        )}
      </div>

      {isOwner && (
        <p>
          <span className={`pill ${recipe.is_published ? 'published' : 'private'}`}>
            {recipe.is_published ? 'Published to community' : 'Private'}
          </span>
        </p>
      )}

      {isOwner && (
        <div className="tabs no-print">
          <button className={tab === 'recipe' ? 'active' : ''} onClick={() => setTab('recipe')}>Recipe</button>
          <button className={tab === 'bakes' ? 'active' : ''} onClick={() => setTab('bakes')}>My Bakes</button>
        </div>
      )}

      {tab === 'recipe' ? (
        <>
        <div className="card">
          {recipe.description && <p>{recipe.description}</p>}

          <div className="recipe-stats">
            {recipe.prep_min ? <div><b>{recipe.prep_min}m</b> prep</div> : null}
            {recipe.cook_min ? <div><b>{recipe.cook_min}m</b> cook</div> : null}
            {totalMin ? <div><b>{totalMin}m</b> total</div> : null}
            {recipe.servings ? <div><b>{recipe.servings}</b> servings</div> : null}
          </div>

          {recipe.images?.length > 0 && (
            <div className="gallery">
              {recipe.images.map((img) => <img key={img.id} src={img.url} alt={recipe.title} />)}
            </div>
          )}

          {recipe.tags?.length > 0 && (
            <div className="tags">{recipe.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>
          )}

          <h2>Ingredients</h2>
          <ul className="ingredients">
            {recipe.ingredients.map((ing, i) => <li key={i}>{ing}</li>)}
          </ul>

          <h2>Steps</h2>
          <ol className="steps">
            {recipe.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
        {recipe.is_published && <RecipeSocial recipeId={id} isOwner={isOwner} />}
        </>
      ) : (
        <BakeLog recipeId={id} />
      )}

      <p className="no-print" style={{ marginTop: '1.5rem' }}><Link to="/">← Back to browse</Link></p>
    </article>
  );
}
