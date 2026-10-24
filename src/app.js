const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TAGS = 5;
const PAGE_SIZE = 24;

const LIMITS = {
  name: 60,
  code: 4000,
  author: 40,
  description: 500,
  tag: 24,
};

// Identifica o formato pelo conteúdo do arquivo, não pela extensão enviada.
function detectImageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return 'gif';
  return null;
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

function parseTags(value) {
  if (typeof value !== 'string') return [];
  const tags = value
    .split(',')
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').slice(0, LIMITS.tag))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, MAX_TAGS);
}

function voterId(req) {
  return crypto.createHash('sha256').update(`${req.ip}|${req.get('user-agent') || ''}`).digest('hex');
}

// Limitador simples em memória: `max` requisições por janela por IP.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip);
    if (!entry || now > entry.reset) {
      hits.set(req.ip, { count: 1, reset: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' });
    }
    entry.count += 1;
    next();
  };
}

function createApp({ db, uploadsDir, adminToken = '', submitLimit = { windowMs: 10 * 60 * 1000, max: 10 } }) {
  fs.mkdirSync(uploadsDir, { recursive: true });

  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES, fields: 10 },
  });

  const stmt = {
    insertSkin: db.prepare('INSERT INTO skins (name, code, author, description) VALUES (?, ?, ?, ?)'),
    insertImage: db.prepare('INSERT INTO skin_images (skin_id, filename, position) VALUES (?, ?, ?)'),
    insertTag: db.prepare('INSERT OR IGNORE INTO skin_tags (skin_id, tag) VALUES (?, ?)'),
    getSkin: db.prepare('SELECT * FROM skins WHERE id = ?'),
    imagesFor: db.prepare('SELECT filename FROM skin_images WHERE skin_id = ? ORDER BY position'),
    tagsFor: db.prepare('SELECT tag FROM skin_tags WHERE skin_id = ? ORDER BY tag'),
    incCopies: db.prepare('UPDATE skins SET copies = copies + 1 WHERE id = ?'),
    hasLike: db.prepare('SELECT 1 FROM skin_likes WHERE skin_id = ? AND voter = ?'),
    addLike: db.prepare('INSERT INTO skin_likes (skin_id, voter) VALUES (?, ?)'),
    delLike: db.prepare('DELETE FROM skin_likes WHERE skin_id = ? AND voter = ?'),
    syncLikes: db.prepare('UPDATE skins SET likes = (SELECT COUNT(*) FROM skin_likes WHERE skin_id = ?) WHERE id = ?'),
    deleteSkin: db.prepare('DELETE FROM skins WHERE id = ?'),
    topTags: db.prepare('SELECT tag, COUNT(*) AS count FROM skin_tags GROUP BY tag ORDER BY count DESC, tag LIMIT 20'),
  };

  function serialize(row, voter) {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      author: row.author,
      description: row.description,
      copies: row.copies,
      likes: row.likes,
      liked: voter ? Boolean(stmt.hasLike.get(row.id, voter)) : false,
      createdAt: row.created_at,
      images: stmt.imagesFor.all(row.id).map((i) => `/uploads/${i.filename}`),
      tags: stmt.tagsFor.all(row.id).map((t) => t.tag),
    };
  }

  function parseId(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID inválido.' });
      return null;
    }
    return id;
  }

  app.get('/api/skins', (req, res) => {
    const q = cleanText(req.query.q, 100);
    const tag = cleanText(req.query.tag, LIMITS.tag).toLowerCase();
    const sort = { popular: 'copies DESC, id DESC', likes: 'likes DESC, id DESC' }[req.query.sort] || 'id DESC';
    const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));

    const where = [];
    const params = [];
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push("(name LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR code = ?)");
      params.push(like, like, like, q);
    }
    if (tag) {
      where.push('id IN (SELECT skin_id FROM skin_tags WHERE tag = ?)');
      params.push(tag);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) AS n FROM skins ${whereSql}`).get(...params).n;
    const rows = db
      .prepare(`SELECT * FROM skins ${whereSql} ORDER BY ${sort} LIMIT ? OFFSET ?`)
      .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);

    const voter = voterId(req);
    res.json({
      skins: rows.map((r) => serialize(r, voter)),
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  });

  app.get('/api/tags', (req, res) => {
    res.json({ tags: stmt.topTags.all() });
  });

  app.get('/api/skins/:id', (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    const row = stmt.getSkin.get(id);
    if (!row) return res.status(404).json({ error: 'Skin não encontrada.' });
    res.json(serialize(row, voterId(req)));
  });

  app.post('/api/skins', rateLimit(submitLimit), (req, res, next) => {
    upload.array('images', MAX_IMAGES)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        const messages = {
          LIMIT_FILE_SIZE: 'Cada imagem pode ter no máximo 5 MB.',
          LIMIT_FILE_COUNT: `Envie no máximo ${MAX_IMAGES} imagens.`,
          LIMIT_UNEXPECTED_FILE: `Envie no máximo ${MAX_IMAGES} imagens.`,
        };
        return res.status(400).json({ error: messages[err.code] || 'Envio inválido.' });
      }
      if (err) return next(err);

      const name = cleanText(req.body?.name, LIMITS.name);
      const code = cleanText(req.body?.code, LIMITS.code);
      const author = cleanText(req.body?.author, LIMITS.author);
      const description = cleanText(req.body?.description, LIMITS.description);
      const tags = parseTags(req.body?.tags);
      const files = req.files || [];

      if (!name) return res.status(400).json({ error: 'Informe o nome da skin.' });
      if (!code) return res.status(400).json({ error: 'Informe o código da skin.' });
      if (files.length === 0) return res.status(400).json({ error: 'Envie pelo menos uma imagem da skin.' });

      const images = [];
      for (const file of files) {
        const ext = detectImageType(file.buffer);
        if (!ext) return res.status(400).json({ error: 'Formato de imagem não suportado. Use PNG, JPG, WEBP ou GIF.' });
        images.push({ buffer: file.buffer, filename: `${crypto.randomUUID()}.${ext}` });
      }

      const written = [];
      try {
        for (const img of images) {
          fs.writeFileSync(path.join(uploadsDir, img.filename), img.buffer, { flag: 'wx' });
          written.push(img.filename);
        }
        const id = db.transaction(() => {
          const skinId = stmt.insertSkin.run(name, code, author, description).lastInsertRowid;
          images.forEach((img, i) => stmt.insertImage.run(skinId, img.filename, i));
          tags.forEach((t) => stmt.insertTag.run(skinId, t));
          return Number(skinId);
        })();
        res.status(201).json(serialize(stmt.getSkin.get(id), voterId(req)));
      } catch (e) {
        for (const f of written) fs.rmSync(path.join(uploadsDir, f), { force: true });
        next(e);
      }
    });
  });

  app.post('/api/skins/:id/copy', (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    const result = stmt.incCopies.run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'Skin não encontrada.' });
    res.json({ copies: stmt.getSkin.get(id).copies });
  });

  app.post('/api/skins/:id/like', (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    if (!stmt.getSkin.get(id)) return res.status(404).json({ error: 'Skin não encontrada.' });
    const voter = voterId(req);
    const liked = db.transaction(() => {
      const already = stmt.hasLike.get(id, voter);
      if (already) stmt.delLike.run(id, voter);
      else stmt.addLike.run(id, voter);
      stmt.syncLikes.run(id, id);
      return !already;
    })();
    res.json({ liked, likes: stmt.getSkin.get(id).likes });
  });

  app.delete('/api/skins/:id', (req, res) => {
    const token = req.get('x-admin-token') || '';
    const valid =
      adminToken &&
      token.length === adminToken.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminToken));
    if (!valid) return res.status(403).json({ error: 'Não autorizado.' });

    const id = parseId(req, res);
    if (id === null) return;
    const files = stmt.imagesFor.all(id);
    const result = stmt.deleteSkin.run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'Skin não encontrada.' });
    for (const f of files) fs.rmSync(path.join(uploadsDir, f.filename), { force: true });
    res.status(204).end();
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  app.use('/uploads', express.static(uploadsDir, { maxAge: '30d', immutable: true, index: false }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  });

  return app;
}

module.exports = { createApp, detectImageType, parseTags };
