import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { scaleIngredients } from '../scale.js';
import BakeLog from '../components/BakeLog.jsx';
import RecipeSocial from '../components/RecipeSocial.jsx';
import Collaborators from '../components/Collaborators.jsx';

export default function RecipeView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [recipe, setRecipe] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [tab, setTab] = useState('recipe');
  const [scale, setScale] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/recipes/${id}`)
      .then(({ recipe, is_owner, can_edit }) => { setRecipe(recipe); setIsOwner(is_owner); setCanEdit(can_edit); })
      .catch((e) => setError(e.message));
  }, [id]);

  async function addToShoppingList() {
    try {
      const { added } = await api.post('/shopping/add', { recipe_ids: [Number(id)] });
      alert(added > 0 ? `Added ${added} item${added === 1 ? '' : 's'} to your shopping list.` : 'Those ingredients are already on your list.');
    } catch (e) {
      alert(e.message);
    }
  }

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
        <div className="no-print" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={() => navigate(`/recipes/${id}/cook`)}>👨‍🍳 Cook</button>
          {user && <button className="secondary" onClick={addToShoppingList}>🛒 Add to list</button>}
          <button className="secondary" onClick={() => window.print()}>Print</button>
          {canEdit && <button className="secondary" onClick={() => navigate(`/recipes/${id}/edit`)}>Edit</button>}
          {isOwner && user?.drive_linked && <button className="secondary" onClick={saveToDrive}>Save PDF to Drive</button>}
          {isOwner && <button onClick={togglePublish}>{recipe.is_published ? 'Unpublish' : 'Publish'}</button>}
          {isOwner && <button className="danger" onClick={remove}>Delete</button>}
        </div>
      </div>

      {isOwner && (
        <p>
          <span className={`pill ${recipe.is_published ? 'published' : 'private'}`}>
            {recipe.is_published ? 'Published to community' : 'Private'}
          </span>
        </p>
      )}
      {!isOwner && canEdit && (
        <p><span className="pill published">Shared with you — you can edit</span></p>
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
          {recipe.cover_url && (
            <img
              src={recipe.cover_url}
              alt={recipe.title}
              style={{ width: '100%', maxHeight: 360, objectFit: 'cover', borderRadius: 10, marginBottom: '1rem' }}
            />
          )}

          {recipe.description && <p>{recipe.description}</p>}

          <div className="recipe-stats">
            {recipe.prep_min ? <div><b>{recipe.prep_min}m</b> prep</div> : null}
            {recipe.cook_min ? <div><b>{recipe.cook_min}m</b> cook</div> : null}
            {totalMin ? <div><b>{totalMin}m</b> total</div> : null}
            {recipe.servings ? <div><b>{recipe.servings}</b> servings</div> : null}
          </div>

          {/* Gallery: general photos that aren't already the cover */}
          {(() => {
            const gallery = (recipe.images || []).filter((im) => im.step_index == null && im.id !== recipe.cover_image_id);
            return gallery.length > 0 ? (
              <div className="gallery">
                {gallery.map((img) => <img key={img.id} src={img.url} alt={recipe.title} />)}
              </div>
            ) : null;
          })()}

          {recipe.tags?.length > 0 && (
            <div className="tags">{recipe.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h2 style={{ marginRight: 'auto' }}>Ingredients</h2>
            <span className="muted no-print" style={{ fontSize: '0.85rem' }}>Scale:</span>
            <select
              className="no-print"
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              style={{ width: 'auto' }}
            >
              <option value={0.5}>½×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={3}>3×</option>
              <option value={4}>4×</option>
            </select>
            {scale !== 1 && recipe.servings ? (
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                (≈ {Math.round(recipe.servings * scale)} servings)
              </span>
            ) : null}
          </div>
          <ul className="ingredients">
            {scaleIngredients(recipe.ingredients, scale).map((ing, i) => <li key={i}>{ing}</li>)}
          </ul>

          <h2>Steps</h2>
          <ol className="steps">
            {recipe.steps.map((s, i) => {
              const stepPhotos = (recipe.images || []).filter((im) => im.step_index === i);
              return (
                <li key={i}>
                  {s}
                  {stepPhotos.length > 0 && (
                    <div className="gallery" style={{ marginTop: '0.5rem' }}>
                      {stepPhotos.map((im) => <img key={im.id} src={im.url} alt="" />)}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
        {recipe.is_published && <RecipeSocial recipeId={id} isOwner={isOwner} />}
        </>
      ) : (
        <BakeLog recipeId={id} />
      )}

      {isOwner && tab === 'recipe' && <Collaborators recipeId={id} />}

      <p className="no-print" style={{ marginTop: '1.5rem' }}><Link to="/">← Back to browse</Link></p>
    </article>
  );
}
