import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../db.js';
import { requireAdmin } from '../auth.js';

const router = Router();

// A readable temporary password to hand to a user after a reset.
function makeTempPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) + '9a';
}

// All admin routes require admin. Note: admins manage *accounts*, not content —
// they intentionally have no access to users' private recipes.
router.use(requireAdmin);

const adminView = (u) => ({
  id: u.id,
  email: u.email,
  display_name: u.display_name,
  role: u.role,
  is_active: !!u.is_active,
  drive_linked: !!u.drive_linked,
  created_at: u.created_at,
  recipe_count: db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE user_id = ?').get(u.id).n,
});

// GET /api/admin/users
router.get('/users', (_req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at').all();
  res.json({ users: users.map(adminView) });
});

// PATCH /api/admin/users/:id — enable/disable or change role.
router.patch('/users/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own admin status or active state' });
  }

  const { is_active, role } = req.body ?? {};
  if (is_active !== undefined) {
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, target.id);
  }
  if (role !== undefined) {
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  }
  res.json({ user: adminView(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) });
});

// POST /api/admin/users/:id/reset-password — set a temp password and return it so
// the admin can relay it (no email). Admins reset *others*, not themselves.
router.post('/users/:id/reset-password', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'Use the change-password form for your own account' });
  }
  const temp = makeTempPassword();
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(temp, 10), target.id);
  res.json({ temp_password: temp });
});

export default router;
