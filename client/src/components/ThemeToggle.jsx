import { useState } from 'react';

// Toggles the light/dark theme by setting data-theme on <html> and persisting it.
export default function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark');

  function toggle() {
    const next = dark ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('dn_theme', next); } catch { /* ignore */ }
    setDark(!dark);
  }

  return (
    <button className="theme-toggle" onClick={toggle} title="Toggle light/dark theme" aria-label="Toggle light/dark theme">
      {dark ? '☀️' : '🌙'}
    </button>
  );
}
