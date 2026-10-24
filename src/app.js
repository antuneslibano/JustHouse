const path = require('node:path');
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

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function createApp({ store, adminToken = '', submitLimit = { windowMs: 10 * 60 * 1000, max: 10 } }) {
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

  function parseId(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID inválido.' });
      return null;
    }
    return id;
  }

  app.get('/api/skins', async (req, res) => {
    const q = cleanText(req.query.q, 100);
    const tag = cleanText(req.query.tag, LIMITS.tag).toLowerCase();
    const sort = ['popular', 'likes'].includes(req.query.sort) ? req.query.sort : 'recent';
    const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));

    const { total, skins } = await store.listSkins({
      q,
      tag,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      voter: voterId(req),
    });
    res.json({
      skins,
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  });

  app.get('/api/tags', async (req, res) => {
    res.json({ tags: await store.topTags() });
  });

  app.get('/api/skins/:id', async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    const skin = await store.getSkin(id, voterId(req));
    if (!skin) return res.status(404).json({ error: 'Skin não encontrada.' });
    res.json(skin);
  });

  app.post('/api/skins', rateLimit(submitLimit), (req, res, next) => {
    upload.array('images', MAX_IMAGES)(req, res, async (err) => {
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
        images.push({ buffer: file.buffer, path: `${crypto.randomUUID()}.${ext}`, contentType: MIME[ext] });
      }

      const uploaded = [];
      try {
        for (const img of images) {
          await store.uploadImage(img.path, img.buffer, img.contentType);
          uploaded.push(img.path);
        }
        const skin = await store.createSkin({ name, code, author, description, tags, images: uploaded });
        res.status(201).json(skin);
      } catch (e) {
        await store.removeImages(uploaded).catch(() => {});
        next(e);
      }
    });
  });

  app.post('/api/skins/:id/copy', async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    const copies = await store.incrementCopies(id);
    if (copies === null) return res.status(404).json({ error: 'Skin não encontrada.' });
    res.json({ copies });
  });

  app.post('/api/skins/:id/like', async (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    const result = await store.toggleLike(id, voterId(req));
    if (!result) return res.status(404).json({ error: 'Skin não encontrada.' });
    res.json(result);
  });

  app.delete('/api/skins/:id', async (req, res) => {
    const token = req.get('x-admin-token') || '';
    const valid =
      adminToken &&
      token.length === adminToken.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminToken));
    if (!valid) return res.status(403).json({ error: 'Não autorizado.' });

    const id = parseId(req, res);
    if (id === null) return;
    const paths = await store.deleteSkin(id);
    if (paths === null) return res.status(404).json({ error: 'Skin não encontrada.' });
    await store.removeImages(paths).catch((e) => console.error('Falha ao remover imagens:', e));
    res.status(204).end();
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  });

  return app;
}

module.exports = { createApp, detectImageType, parseTags };
