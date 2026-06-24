import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const DRIVE_MESSAGES = {
  connected: { kind: 'ok', text: 'Google Drive connected! Your photos now live in your Drive.' },
  denied: { kind: 'err', text: 'Drive connection was cancelled.' },
  error: { kind: 'err', text: 'Something went wrong connecting Drive. Please try again.' },
  norefresh: { kind: 'err', text: 'Google didn’t return a refresh token. Disconnect the app at myaccount.google.com/permissions, then try again.' },
};

export default function Account() {
  const { refresh } = useAuth();
  const [status, setStatus] = useState(null);
  const [collections, setCollections] = useState([]);
  const [note, setNote] = useState('');
  const [params, setParams] = useSearchParams();

  function load() {
    api.get('/drive/status').then(setStatus).catch(() => setStatus({ configured: false, linked: false }));
    api.get('/collections').then((d) => setCollections(d.collections)).catch(() => {});
  }
  useEffect(load, []);

  // Show feedback from the OAuth callback redirect, then clean the URL.
  useEffect(() => {
    const drive = params.get('drive');
    if (drive && DRIVE_MESSAGES[drive]) {
      setNote(drive);
      refresh(); // drive_linked may have changed
      params.delete('drive');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function disconnect() {
    if (!confirm('Disconnect Google Drive? Photos already in your Drive stay there, but the app will store new photos locally again.')) return;
    await api.post('/drive/disconnect');
    await refresh();
    load();
  }

  async function exportCollection(id) {
    setNote('');
    try {
      const { link } = await api.post(`/drive/export/collection/${id}`);
      window.open(link, '_blank');
    } catch (e) {
      alert(e.message);
    }
  }

  if (!status) return <p>Loading…</p>;
  const msg = note && DRIVE_MESSAGES[note];

  return (
    <div>
      <h1>Account</h1>
      {msg && <p className={msg.kind === 'ok' ? 'muted' : 'error'} style={msg.kind === 'ok' ? { color: 'var(--sage)' } : undefined}>{msg.text}</p>}

      <div className="card">
        <h2>Google Drive</h2>
        {!status.configured ? (
          <p className="muted">Google Drive isn’t set up on this server.</p>
        ) : status.linked ? (
          <>
            <p>Connected as <strong>{status.google_email || 'your Google account'}</strong>.</p>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              New photos are stored in a <strong>DoughNotes</strong> folder in your Drive (no size cap),
              and you can save recipe books as PDFs there.
            </p>
            <button className="danger" onClick={disconnect}>Disconnect Drive</button>
          </>
        ) : (
          <>
            <p>
              Connect your Google Drive to store unlimited recipe photos and save your
              collections as <strong>recipe-book PDFs</strong>.
            </p>
            <a className="btn" href="/api/drive/connect">Connect Google Drive</a>
          </>
        )}
      </div>

      {status.linked && (
        <div className="card" style={{ marginTop: '1.2rem' }}>
          <h2>Save a recipe book to Drive</h2>
          {collections.length === 0 ? (
            <p className="muted">Create a collection (and add recipes to it) to export it as a book.</p>
          ) : (
            <table>
              <thead><tr><th>Collection</th><th>Recipes</th><th></th></tr></thead>
              <tbody>
                {collections.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.recipe_count}</td>
                    <td><button className="secondary" onClick={() => exportCollection(c.id)} disabled={c.recipe_count === 0}>Save as PDF</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
