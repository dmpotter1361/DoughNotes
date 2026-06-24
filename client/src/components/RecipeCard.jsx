import { Link } from 'react-router-dom';

export default function RecipeCard({ recipe }) {
  const totalMin = (recipe.prep_min || 0) + (recipe.cook_min || 0);
  return (
    <Link to={`/recipes/${recipe.id}`} className="recipe-card card">
      {recipe.images?.[0] && <img className="thumb" src={recipe.images[0].url} alt={recipe.title} />}
      <h3>{recipe.title}</h3>
      <div className="meta">
        by {recipe.author}
        {totalMin > 0 && ` · ${totalMin} min`}
        {recipe.servings ? ` · serves ${recipe.servings}` : ''}
      </div>
      {recipe.description && <p className="muted" style={{ margin: '0.5rem 0 0' }}>{recipe.description.slice(0, 90)}{recipe.description.length > 90 ? '…' : ''}</p>}
      {recipe.tags?.length > 0 && (
        <div className="tags">
          {recipe.tags.map((t) => <span key={t} className="tag">#{t}</span>)}
        </div>
      )}
    </Link>
  );
}
