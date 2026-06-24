import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function ShoppingList() {
  const [items, setItems] = useState(null);
  const [newItem, setNewItem] = useState('');
  const [error, setError] = useState('');

  function load() {
    api.get('/shopping').then((d) => setItems(d.items)).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function toggle(item) {
    await api.patch(`/shopping/${item.id}`, { checked: !item.checked });
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)));
  }
  async function remove(item) {
    await api.del(`/shopping/${item.id}`);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }
  async function addManual(e) {
    e.preventDefault();
    if (!newItem.trim()) return;
    await api.post('/shopping/items', { labels: [newItem.trim()] });
    setNewItem('');
    load();
  }
  async function clearChecked() {
    await api.del('/shopping?checked=1');
    load();
  }
  async function clearAll() {
    if (!confirm('Clear the entire shopping list?')) return;
    await api.del('/shopping');
    load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!items) return <p>Loading…</p>;

  const checkedCount = items.filter((i) => i.checked).length;

  return (
    <div>
      <h1>Shopping List</h1>
      <form onSubmit={addManual} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item…" />
        <button type="submit">Add</button>
      </form>

      {items.length === 0 ? (
        <p className="muted">Your list is empty. Add items above, or use “Add to shopping list” on a recipe.</p>
      ) : (
        <div className="card">
          {items.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0', borderBottom: '1px solid var(--line)' }}>
              <input type="checkbox" checked={item.checked} onChange={() => toggle(item)} style={{ width: 'auto' }} />
              <span style={{ flex: 1, textDecoration: item.checked ? 'line-through' : 'none', color: item.checked ? 'var(--cocoa-soft)' : 'inherit' }}>
                {item.label}
              </span>
              <button className="danger" style={{ padding: '0.05rem 0.45rem' }} onClick={() => remove(item)}>×</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button className="secondary" onClick={clearChecked} disabled={checkedCount === 0}>Clear checked ({checkedCount})</button>
            <button className="danger" onClick={clearAll}>Clear all</button>
          </div>
        </div>
      )}
    </div>
  );
}
