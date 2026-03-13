import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'db.json');
const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const MAX_BODY = 20 * 1024 * 1024;

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(publicDir, 'uploads'), { recursive: true });

const sessions = new Map();

function nowIso() { return new Date().toISOString(); }
function randomId(prefix = 'id') { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
function hashPassword(password) { return crypto.createHash('sha256').update(password).digest('hex'); }

function parseCookies(cookieHeader = '') {
  const out = {};
  cookieHeader.split(';').forEach((part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k) return;
    out[k] = decodeURIComponent(rest.join('='));
  });
  return out;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif'
  }[ext] || 'application/octet-stream';
}

function seedData() {
  return {
    users: [{
      id: 'user_demo', username: 'demo', passwordHash: hashPassword('demo123'), displayName: 'Demo Creator',
      avatar: '', bio: 'Тестовый аккаунт для входа: demo / demo123', createdAt: nowIso()
    }],
    posts: [
      {
        id: 'post_demo_video', authorId: 'user_demo', authorName: 'Demo Creator', authorHandle: '@demo',
        caption: 'Демо-ролик: полноэкранная лента, комментарии снизу, вкладки и студия для публикации.',
        mediaType: 'clip', mediaUrl: '', clipTheme: 'neon', likes: 14,
        comments: [{ id: randomId('comment'), authorId: 'user_demo', authorName: 'Demo Creator', text: 'Это стартовый комментарий. Новые можно писать снизу.', createdAt: nowIso() }],
        createdAt: nowIso()
      },
      {
        id: 'post_demo_photo', authorId: 'user_demo', authorName: 'Demo Creator', authorHandle: '@demo',
        caption: 'Можно грузить фото и короткие видео прямо из студии.',
        mediaType: 'image',
        mediaUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
            <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#111827" offset="0%"/><stop stop-color="#ec4899" offset="60%"/><stop stop-color="#22d3ee" offset="100%"/></linearGradient></defs>
            <rect fill="url(#g)" width="720" height="1280" rx="40"/>
            <circle cx="600" cy="170" r="140" fill="rgba(255,255,255,.12)"/>
            <circle cx="160" cy="1030" r="180" fill="rgba(255,255,255,.10)"/>
            <text x="72" y="250" fill="#fff" font-size="64" font-family="Arial" font-weight="700">Tikitok</text>
            <text x="72" y="340" fill="#fff" font-size="44" font-family="Arial">Фото-пост</text>
            <text x="72" y="980" fill="#fff" font-size="36" font-family="Arial">Фото-пост для ленты</text>
          </svg>
        `),
        clipTheme: '', likes: 7, comments: [], createdAt: nowIso()
      }
    ]
  };
}

function loadDb() {
  if (!fs.existsSync(dbFile)) {
    const seeded = seedData();
    fs.writeFileSync(dbFile, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    parsed.users ||= [];
    parsed.posts ||= [];
    return parsed;
  } catch {
    const seeded = seedData();
    fs.writeFileSync(dbFile, JSON.stringify(seeded, null, 2));
    return seeded;
  }
}

let db = loadDb();
function saveDb() { fs.writeFileSync(dbFile, JSON.stringify(db, null, 2)); }

function send(res, status, payload, headers = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': typeof payload === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sanitizeText(value, max = 500) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function currentUser(req) {
  const sid = parseCookies(req.headers.cookie).sid;
  if (!sid) return null;
  const userId = sessions.get(sid);
  return db.users.find((user) => user.id === userId) || null;
}
function publicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, bio: user.bio, createdAt: user.createdAt };
}
function authRequired(req, res) {
  const user = currentUser(req);
  if (!user) { send(res, 401, { ok: false, error: 'Нужен вход в аккаунт' }); return null; }
  return user;
}
function postView(post) { return { ...post, commentCount: post.comments.length }; }

function serveStatic(req, res, pathname) {
  let safePath = decodeURIComponent(pathname);
  if (safePath === '/') safePath = '/index.html';
  const fullPath = path.normalize(path.join(publicDir, safePath));
  if (!fullPath.startsWith(publicDir)) { send(res, 403, 'Forbidden'); return true; }
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return false;
  res.writeHead(200, { 'Content-Type': getMimeType(fullPath), 'Cache-Control': fullPath.endsWith('index.html') ? 'no-store' : 'public, max-age=300' });
  fs.createReadStream(fullPath).pipe(res);
  return true;
}

function createSession(res, userId) {
  const sid = randomId('sid');
  sessions.set(sid, userId);
  res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
}
function clearSession(req, res) {
  const sid = parseCookies(req.headers.cookie).sid;
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

const server = http.createServer(async (req, res) => {
  withCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (req.method === 'GET' && pathname === '/health') {
      send(res, 200, { ok: true, service: 'tikitok-full', uptime: Math.round(process.uptime()), users: db.users.length, posts: db.posts.length, time: nowIso() });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/bootstrap') {
      const user = currentUser(req);
      const posts = [...db.posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(postView);
      send(res, 200, { ok: true, user: publicUser(user), posts, profilePosts: user ? posts.filter((post) => post.authorId === user.id) : [], stats: { users: db.users.length, posts: db.posts.length } });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/register') {
      const body = await readJson(req);
      const username = sanitizeText(body.username, 24).toLowerCase().replace(/[^a-z0-9_]/g, '');
      const password = String(body.password || '');
      const displayName = sanitizeText(body.displayName || username, 32);
      if (username.length < 3) return send(res, 400, { ok: false, error: 'Логин должен быть минимум 3 символа' });
      if (password.length < 4) return send(res, 400, { ok: false, error: 'Пароль должен быть минимум 4 символа' });
      if (db.users.some((user) => user.username === username)) return send(res, 409, { ok: false, error: 'Такой логин уже занят' });
      const user = { id: randomId('user'), username, passwordHash: hashPassword(password), displayName: displayName || username, avatar: '', bio: 'Новый пользователь Tikitok', createdAt: nowIso() };
      db.users.push(user); saveDb(); createSession(res, user.id); send(res, 200, { ok: true, user: publicUser(user) });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/login') {
      const body = await readJson(req);
      const username = sanitizeText(body.username, 24).toLowerCase();
      const password = String(body.password || '');
      const user = db.users.find((item) => item.username === username && item.passwordHash === hashPassword(password));
      if (!user) return send(res, 401, { ok: false, error: 'Неверный логин или пароль' });
      createSession(res, user.id); send(res, 200, { ok: true, user: publicUser(user) });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/logout') { clearSession(req, res); send(res, 200, { ok: true }); return; }
    if (req.method === 'POST' && pathname === '/api/posts') {
      const user = authRequired(req, res); if (!user) return;
      const body = await readJson(req);
      const caption = sanitizeText(body.caption, 220);
      const mediaType = ['image', 'video', 'clip'].includes(body.mediaType) ? body.mediaType : 'clip';
      const mediaUrl = typeof body.mediaUrl === 'string' ? body.mediaUrl.slice(0, 8_000_000) : '';
      const clipTheme = sanitizeText(body.clipTheme || 'neon', 20);
      if (!caption && !mediaUrl && mediaType !== 'clip') return send(res, 400, { ok: false, error: 'Добавь подпись или файл' });
      if ((mediaType === 'image' || mediaType === 'video') && !mediaUrl.startsWith('data:')) return send(res, 400, { ok: false, error: 'Файл должен передаваться как data URL' });
      const post = { id: randomId('post'), authorId: user.id, authorName: user.displayName, authorHandle: `@${user.username}`, caption, mediaType, mediaUrl, clipTheme, likes: 0, comments: [], createdAt: nowIso() };
      db.posts.unshift(post); saveDb(); send(res, 200, { ok: true, post: postView(post) }); return;
    }
    if (req.method === 'POST' && /^\/api\/posts\/[^/]+\/like$/.test(pathname)) {
      const user = authRequired(req, res); if (!user) return;
      const post = db.posts.find((item) => item.id === pathname.split('/')[3]);
      if (!post) return send(res, 404, { ok: false, error: 'Пост не найден' });
      post.likes += 1; saveDb(); send(res, 200, { ok: true, post: postView(post) }); return;
    }
    if (req.method === 'POST' && /^\/api\/posts\/[^/]+\/comments$/.test(pathname)) {
      const user = authRequired(req, res); if (!user) return;
      const post = db.posts.find((item) => item.id === pathname.split('/')[3]);
      if (!post) return send(res, 404, { ok: false, error: 'Пост не найден' });
      const text = sanitizeText((await readJson(req)).text, 180);
      if (!text) return send(res, 400, { ok: false, error: 'Комментарий пустой' });
      post.comments.push({ id: randomId('comment'), authorId: user.id, authorName: user.displayName, text, createdAt: nowIso() });
      saveDb(); send(res, 200, { ok: true, post: postView(post) }); return;
    }
    if (req.method === 'GET' && pathname.startsWith('/api/')) return send(res, 404, { ok: false, error: 'API route not found' });
    if (serveStatic(req, res, pathname)) return;
    sendHtml(res, fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8'));
  } catch (error) {
    send(res, 500, { ok: false, error: error.message || 'Server error' });
  }
});

server.listen(PORT, HOST, () => console.log(`Tikitok full demo listening on http://${HOST}:${PORT}`));
