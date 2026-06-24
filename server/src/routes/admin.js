import { Router } from 'express';
import db from '../db.js';
import { requireAdmin } from '../auth.js';

const router = Router();

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

export default router;
