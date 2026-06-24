import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ display_name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(form.email, form.password, form.display_name);
      navigate('/my');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-box card">
      <h1>Create your account</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="name">Display name</label>
        <input id="name" value={form.display_name} onChange={update('display_name')} required />
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={form.email} onChange={update('email')} required />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={form.password} onChange={update('password')} required minLength={8} />
        <p className="muted" style={{ fontSize: '0.85rem' }}>At least 8 characters.</p>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy} style={{ marginTop: '0.5rem', width: '100%' }}>
          {busy ? 'Creating…' : 'Sign up'}
        </button>
      </form>
      <p className="center muted" style={{ marginTop: '1rem' }}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
