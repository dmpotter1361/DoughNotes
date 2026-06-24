import { OAuth2Client } from 'google-auth-library';
import db from './db.js';

// Google Drive integration. Each user links their own Google account; we store a
// refresh token and use the least-privilege `drive.file` scope (we can only touch
// files this app creates). Images live in a `DoughNotes` folder in their Drive.

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
];
const FOLDER_NAME = 'DoughNotes';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export function driveConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri() {
  const base = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3500}`;
  return `${base.replace(/\/$/, '')}/api/drive/callback`;
}

export function getOAuthClient() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri()
  );
}

// Build the consent URL. `state` ties the callback back to the logged-in user.
export function getAuthUrl(state) {
  return getOAuthClient().generateAuthUrl({
    access_type: 'offline',     // get a refresh token
    prompt: 'consent',          // force refresh token even on re-link
    scope: SCOPES,
    state,
  });
}

// Exchange the authorization code for tokens + the linked Google email.
export async function exchangeCode(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  let email = null;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    email = ticket.getPayload()?.email ?? null;
  }
  return { tokens, email };
}

// Persist a freshly-linked account, then ensure the Drive folder exists.
export async function saveLinkedAccount(userId, tokens, email) {
  db.prepare(
    `INSERT INTO google_accounts (user_id, google_email, refresh_token, access_token, token_expiry, linked_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       google_email = excluded.google_email,
       refresh_token = excluded.refresh_token,
       access_token = excluded.access_token,
       token_expiry = excluded.token_expiry,
       linked_at = datetime('now')`
  ).run(userId, email, tokens.refresh_token, tokens.access_token ?? null, tokens.expiry_date ?? null);
  db.prepare('UPDATE users SET drive_linked = 1 WHERE id = ?').run(userId);
  await ensureFolder(userId);
}

export function getLinkedAccount(userId) {
  return db.prepare('SELECT * FROM google_accounts WHERE user_id = ?').get(userId);
}

// Return a valid access token for the user, refreshing + persisting if expired.
export async function getValidAccessToken(userId) {
  const acct = getLinkedAccount(userId);
  if (!acct) throw new Error('Google Drive is not linked for this user');

  const stillValid = acct.access_token && acct.token_expiry && acct.token_expiry - Date.now() > 60_000;
  if (stillValid) return acct.access_token;

  const client = getOAuthClient();
  client.setCredentials({ refresh_token: acct.refresh_token });
  const { token } = await client.getAccessToken(); // refreshes using the refresh token
  const creds = client.credentials;
  db.prepare('UPDATE google_accounts SET access_token = ?, token_expiry = ? WHERE user_id = ?')
    .run(token, creds.expiry_date ?? Date.now() + 3_000_000, userId);
  return token;
}

async function driveFetch(userId, url, options = {}) {
  const token = await getValidAccessToken(userId);
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Drive API ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

// Find or create the user's DoughNotes folder; cache its id.
export async function ensureFolder(userId) {
  const acct = getLinkedAccount(userId);
  if (acct?.drive_folder_id) return acct.drive_folder_id;

  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const found = await driveFetch(userId, `${DRIVE_API}/files?q=${q}&fields=files(id)`).then((r) => r.json());
  let folderId = found.files?.[0]?.id;

  if (!folderId) {
    const created = await driveFetch(userId, `${DRIVE_API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    }).then((r) => r.json());
    folderId = created.id;
  }
  db.prepare('UPDATE google_accounts SET drive_folder_id = ? WHERE user_id = ?').run(folderId, userId);
  return folderId;
}

// Multipart upload of a buffer to the user's DoughNotes folder. Returns the file id.
export async function uploadFile(userId, { buffer, mimeType, name }) {
  const folderId = await ensureFolder(userId);
  const boundary = `dn${Date.now().toString(16)}`;
  const meta = JSON.stringify({ name, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await driveFetch(userId, `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()).id;
}

// Stream a file's bytes back (used to proxy images to browsers).
export async function downloadFile(userId, fileId) {
  const res = await driveFetch(userId, `${DRIVE_API}/files/${fileId}?alt=media`);
  return {
    contentType: res.headers.get('content-type') || 'application/octet-stream',
    body: res.body, // a web ReadableStream
  };
}

export async function deleteFile(userId, fileId) {
  try {
    await driveFetch(userId, `${DRIVE_API}/files/${fileId}`, { method: 'DELETE' });
  } catch {
    // Best effort — if it's already gone, that's fine.
  }
}

// Disconnect: revoke the refresh token with Google and forget the account.
// Files already in the user's Drive are left in place.
export async function disconnect(userId) {
  const acct = getLinkedAccount(userId);
  if (acct?.refresh_token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${acct.refresh_token}`, { method: 'POST' });
    } catch {
      // ignore revoke failures
    }
  }
  db.prepare('DELETE FROM google_accounts WHERE user_id = ?').run(userId);
  db.prepare('UPDATE users SET drive_linked = 0 WHERE id = ?').run(userId);
}
