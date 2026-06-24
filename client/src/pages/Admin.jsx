import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Admin() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');

  function load() {
    api.get('/admin/users').then((d) => setUsers(d.users)).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function patch(id, body) {
    setError('');
    try {
      const { user } = await api.patch(`/admin/users/${id}`, body);
      setUsers((prev) => prev.map((u) => (u.id === id ? user : u)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function resetPassword(u) {
    if (!confirm(`Reset ${u.display_name}'s password to a new temporary one?`)) return;
    setError('');
    try {
      const { temp_password } = await api.post(`/admin/users/${u.id}/reset-password`);
      prompt(`Temporary password for ${u.display_name} — copy it and give it to them:`, temp_password);
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteUser(u) {
    if (!confirm(`Permanently DELETE ${u.display_name} (${u.email}) and all ${u.recipe_count} of their recipes? This cannot be undone.`)) return;
    if (!confirm(`Really delete ${u.display_name}? Last chance.`)) return;
    setError('');
    try {
      await api.del(`/admin/users/${u.id}`);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!users) return <p>Loading…</p>;

  return (
    <div>
      <h1>User Management</h1>
      <p className="muted">
        Manage accounts here. Note: admins manage <em>accounts</em>, not content —
        you cannot see other users' private recipes.
      </p>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Role</th><th>Recipes</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === me.id;
              return (
                <tr key={u.id}>
                  <td>{u.display_name}{self && <span className="muted"> (you)</span>}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.recipe_count}</td>
                  <td>
                    <span className={`pill ${u.is_active ? 'published' : 'private'}`}>
                      {u.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!self && (
                      <>
                        <button
                          className="secondary"
                          style={{ padding: '0.25rem 0.6rem', marginRight: '0.4rem' }}
                          onClick={() => patch(u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}
                        >
                          {u.role === 'admin' ? 'Make user' : 'Make admin'}
                        </button>
                        <button
                          className={u.is_active ? 'danger' : ''}
                          style={{ padding: '0.25rem 0.6rem', marginRight: '0.4rem' }}
                          onClick={() => patch(u.id, { is_active: !u.is_active })}
                        >
                          {u.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          className="secondary"
                          style={{ padding: '0.25rem 0.6rem', marginRight: '0.4rem' }}
                          onClick={() => resetPassword(u)}
                        >
                          Reset password
                        </button>
                        <button
                          className="danger"
                          style={{ padding: '0.25rem 0.6rem' }}
                          onClick={() => deleteUser(u)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
