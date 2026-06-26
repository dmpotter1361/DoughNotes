import jwt from 'jsonwebtoken';

// Require a real secret in production; only fall back to a throwaway in dev.
const JWT_SECRET = process.env.JWT_SECRET
  || (process.env.NODE_ENV === 'production' ? null : 'dev-insecure-secret-change-me');
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production (refusing to start with an insecure default).');
}
const COOKIE_NAME = 'dn_token';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Only mark the cookie `secure` when actually served over HTTPS. Defaults to
    // off so logins work over plain HTTP; set COOKIE_SECURE=true once TLS is in place.
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: MAX_AGE_MS,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// Populates req.user from the cookie if present + valid. Never rejects.
export function attachUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      req.user = null;
    }
  }
  next();
}

// Gate: must be logged in.
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

// Gate: must be an admin.
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
