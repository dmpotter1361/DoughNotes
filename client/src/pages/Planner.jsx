import { useEffect, useState, useMemo } from 'react';
import { api } from '../api.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const iso = (d) => d.toISOString().slice(0, 10);

// Monday of the week containing `date` (UTC-safe).
function mondayOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

export default function Planner() {
  const [start, setStart] = useState(() => mondayOf(new Date()));
  const [entries, setEntries] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const startStr = iso(start);
  const days = useMemo(
    () => DAYS.map((name, i) => {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      return { name, date: iso(d) };
    }),
    [startStr] // eslint-disable-line react-hooks/exhaustive-deps
  );

  function load() {
    api.get(`/planner?start=${startStr}`).then((d) => setEntries(d.entries)).catch((e) => setError(e.message));
  }
  useEffect(load, [startStr]);

  // Recipes available to plan: your own + published community ones.
  useEffect(() => {
    Promise.all([
      api.get('/recipes/mine').then((d) => d.recipes).catch(() => []),
      api.get('/recipes/public').then((d) => d.recipes).catch(() => []),
    ]).then(([mine, pub]) => {
      const byId = new Map();
      [...mine, ...pub].forEach((r) => byId.set(r.id, r));
      setRecipes([...byId.values()].sort((a, b) => a.title.localeCompare(b.title)));
    });
  }, []);

  async function addToDay(date, recipeId) {
    if (!recipeId) return;
    const { entry } = await api.post('/planner', { plan_date: date, recipe_id: Number(recipeId) });
    setEntries((prev) => [...prev, entry]);
  }
  async function removeEntry(id) {
    await api.del(`/planner/${id}`);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }
  async function generateShopping() {
    setNote('');
    const { added, recipes: n } = await api.post('/planner/shopping', { start: startStr });
    setNote(`Added ${added} item${added === 1 ? '' : 's'} from ${n} recipe${n === 1 ? '' : 's'} to your shopping list.`);
  }
  function shiftWeek(weeks) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + weeks * 7);
    setStart(d);
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <div className="recipe-header">
        <h1>Meal Planner</h1>
        <button onClick={generateShopping}>🛒 Generate shopping list</button>
      </div>
      {note && <p className="muted" style={{ color: 'var(--sage)' }}>{note}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '0.5rem 0 1rem' }}>
        <button className="secondary" onClick={() => shiftWeek(-1)}>← Prev</button>
        <span className="muted">Week of {startStr}</span>
        <button className="secondary" onClick={() => shiftWeek(1)}>Next →</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.8rem' }}>
        {days.map((day) => {
          const dayEntries = entries.filter((e) => e.plan_date === day.date);
          return (
            <div key={day.date} className="card" style={{ padding: '0.8rem' }}>
              <h3 style={{ margin: '0 0 0.5rem' }}>{day.name} <span className="muted" style={{ fontWeight: 400, fontSize: '0.8rem' }}>{day.date.slice(5)}</span></h3>
              {dayEntries.map((e) => (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.3rem', fontSize: '0.9rem', marginBottom: '0.3rem' }}>
                  <span>{e.title}</span>
                  <button className="danger" style={{ padding: '0 0.4rem' }} onClick={() => removeEntry(e.id)}>×</button>
                </div>
              ))}
              <select value="" onChange={(ev) => { addToDay(day.date, ev.target.value); ev.target.value = ''; }} style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
                <option value="">+ Add recipe…</option>
                {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
