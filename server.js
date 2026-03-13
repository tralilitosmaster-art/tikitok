import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const indexFile = path.join(publicDir, 'index.html');

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';

const clients = new Set();
let nextPostId = 4;
let nextCommentId = 4;

const state = {
  online: 0,
  feed: [
    {
      id: 1,
      author: '@tralilitosmaster',
      title: 'Тикиток: сервер на Render без использования модуля ws',
      caption: 'Когда поднял сервер на Render и понял, что ws ставить не хочешь. Решение — realtime через SSE. #render #sse #nodejs',
      voice: 'Ну всё, сейчас realtime полетит...',
      badge: 'Кадр 1',
      likes: 12400,
      shares: 842,
      comments: [
        { id: 1, author: '@backend_cat', text: 'SSE вообще недооценён.', at: new Date().toISOString() }
      ],
      gradient: 'linear-gradient(135deg, #1a1a1a, #2e0f1f)',
      accent: 'Когда поднял сервер на Render'
    },
    {
      id: 2,
      author: '@tralilitosmaster',
      title: 'Без использования модуля ws — это не баг, это подход',
      caption: 'Node на Render, один HTTP сервер, один HTML интерфейс и ни одной зависимости кроме стандартных модулей. #nows #render',
      voice: 'Но модуля ws нет — и не нужен.',
      badge: 'Кадр 2',
      likes: 9300,
      shares: 510,
      comments: [
        { id: 2, author: '@ops_frog', text: 'Вот это уже норм тема.', at: new Date().toISOString() }
      ],
      gradient: 'linear-gradient(135deg, #0d1f2e, #131313)',
      accent: 'Но модуля ws нет'
    },
    {
      id: 3,
      author: '@tralilitosmaster',
      title: 'деплой != работает, но этот уже работает',
      caption: 'Лайки, комменты, онлайн и live-события идут через EventSource. Клиент отправляет POST, сервер пушит всем через SSE. #eventsource',
      voice: 'Сначала зависимости, потом амбиции. А лучше вообще без лишних.',
      badge: 'Кадр 3',
      likes: 7400,
      shares: 322,
      comments: [
        { id: 3, author: '@frontend_orca', text: 'Интерфейс уже реально похож на тикток.', at: new Date().toISOString() }
      ],
      gradient: 'linear-gradient(135deg, #24112f, #111111)',
      accent: 'деплой ≠ работает'
    }
  ]
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function updateOnline() {
  state.online = clients.size;
  broadcast('presence', { online: state.online });
}

function serveStatic(req, res) {
  if (req.url === '/' || req.url === '/index.html') {
    const html = fs.readFileSync(indexFile);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(html);
    return true;
  }

  const safePath = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([.][.][/\\])+/, '');
  const targetFile = path.join(publicDir, safePath);
  if (!targetFile.startsWith(publicDir) || !fs.existsSync(targetFile) || fs.statSync(targetFile).isDirectory()) {
    return false;
  }

  const ext = path.extname(targetFile).toLowerCase();
  const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8'
  };

  res.writeHead(200, {
    'Content-Type': contentTypes[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(targetFile).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, online: state.online, posts: state.feed.length });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/state') {
      sendJson(res, 200, { ok: true, state });
      return;
    }

    if (req.method === 'GET' && req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ state, connectedAt: Date.now() })}\n\n`);
      clients.add(res);
      updateOnline();

      const heartbeat = setInterval(() => {
        res.write(`event: ping\ndata: ${Date.now()}\n\n`);
      }, 20000);

      req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
        updateOnline();
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/post') {
      const body = await parseBody(req);
      const text = String(body.text || '').trim().slice(0, 180);
      if (!text) {
        sendJson(res, 400, { ok: false, error: 'Пустой текст поста.' });
        return;
      }

      const post = {
        id: nextPostId++,
        author: '@you',
        title: 'Новый лайв-пост без использования модуля ws',
        caption: text,
        voice: 'Новый пост прилетел через SSE.',
        badge: 'LIVE',
        likes: 0,
        shares: 0,
        comments: [],
        gradient: 'linear-gradient(135deg, #112b18, #111111)',
        accent: text
      };

      state.feed.unshift(post);
      broadcast('post', { post });
      sendJson(res, 200, { ok: true, post });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/like') {
      const body = await parseBody(req);
      const post = state.feed.find((item) => item.id === Number(body.postId));
      if (!post) {
        sendJson(res, 404, { ok: false, error: 'Пост не найден.' });
        return;
      }
      post.likes += 1;
      broadcast('like', { postId: post.id, likes: post.likes });
      sendJson(res, 200, { ok: true, postId: post.id, likes: post.likes });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/comment') {
      const body = await parseBody(req);
      const post = state.feed.find((item) => item.id === Number(body.postId));
      const text = String(body.text || '').trim().slice(0, 140);
      if (!post) {
        sendJson(res, 404, { ok: false, error: 'Пост не найден.' });
        return;
      }
      if (!text) {
        sendJson(res, 400, { ok: false, error: 'Пустой комментарий.' });
        return;
      }
      const comment = {
        id: nextCommentId++,
        author: '@you',
        text,
        at: new Date().toISOString()
      };
      post.comments.unshift(comment);
      broadcast('comment', { postId: post.id, comment, total: post.comments.length });
      sendJson(res, 200, { ok: true, postId: post.id, comment, total: post.comments.length });
      return;
    }

    if (req.method === 'GET' && serveStatic(req, res)) {
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || 'Server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Tikitok server without ws is running on http://${HOST}:${PORT}`);
});
