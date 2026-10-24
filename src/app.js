const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

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

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const EXT_BY_MIME = Object.fromEntries(Object.entries(MIME).map(([ext, mime]) => [mime, ext]));
const IMAGE_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/;

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

// `ipHeader`: cabeçalho com o IP real do visitante quando há um proxy na frente
// (no Netlify, x-nf-client-connection-ip). `uploadLimit`: envios por IP na janela.
function createApp({
  store,
  adminToken = '',
  ipHeader = '',
  uploadLimit = { max: 10, windowSeconds: 10 * 60 },
}) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  const clientIp = (req) => (ipHeader && req.get(ipHeader)) || req.ip || '';
  const voterId = (req) => hash(`${clientIp(req)}|${req.get('user-agent') || ''}`);

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.use('/api', express.json({ limit: '32kb' }));

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

  // Passo 1 do envio: o navegador informa as imagens e recebe links assinados
  // para enviá-las direto ao Storage (as functions do Netlify aceitam no máximo 6 MB).
  app.post('/api/uploads', async (req, res) => {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0) return res.status(400).json({ error: 'Envie pelo menos uma imagem da skin.' });
    if (files.length > MAX_IMAGES) return res.status(400).json({ error: `Envie no máximo ${MAX_IMAGES} imagens.` });

    const paths = [];
    for (const file of files) {
      const ext = EXT_BY_MIME[file?.type];
      if (!ext) return res.status(400).json({ error: 'Formato de imagem não suportado. Use PNG, JPG, WEBP ou GIF.' });
      if (!(Number(file.size) > 0 && Number(file.size) <= MAX_IMAGE_BYTES)) {
        return res.status(400).json({ error: 'Cada imagem pode ter no máximo 5 MB.' });
      }
      paths.push(`${crypto.randomUUID()}.${ext}`);
    }

    const allowed = await store.hitRateLimit(`upload:${hash(clientIp(req))}`, uploadLimit.max, uploadLimit.windowSeconds);
    if (!allowed) return res.status(429).json({ error: 'Muitos envios. Aguarde alguns minutos e tente novamente.' });

    const uploads = await Promise.all(paths.map(async (p) => ({ path: p, url: await store.createUploadUrl(p) })));
    res.json({ uploads });
  });

  // Passo 2 do envio: cria a skin com as imagens já enviadas, depois de conferi-las.
  app.post('/api/skins', async (req, res) => {
    const body = req.body || {};
    const name = cleanText(body.name, LIMITS.name);
    const code = cleanText(body.code, LIMITS.code);
    const author = cleanText(body.author, LIMITS.author);
    const description = cleanText(body.description, LIMITS.description);
    const tags = parseTags(body.tags);
    const images = Array.isArray(body.images) ? body.images : [];

    if (!name) return res.status(400).json({ error: 'Informe o nome da skin.' });
    if (!code) return res.status(400).json({ error: 'Informe o código da skin.' });
    if (images.length === 0) return res.status(400).json({ error: 'Envie pelo menos uma imagem da skin.' });
    if (images.length > MAX_IMAGES) return res.status(400).json({ error: `Envie no máximo ${MAX_IMAGES} imagens.` });
    if (!images.every((p) => typeof p === 'string' && IMAGE_PATH.test(p)) || new Set(images).size !== images.length) {
      return res.status(400).json({ error: 'Imagens inválidas. Tente enviar de novo.' });
    }

    const checks = await Promise.all(images.map((p) => store.readImageHead(p, 16)));
    const bad = images.filter((p, i) => {
      const info = checks[i];
      return !info || info.size > MAX_IMAGE_BYTES || detectImageType(info.head) !== p.split('.').pop();
    });
    if (bad.length) {
      await store.removeImages(bad.filter((p, i) => checks[images.indexOf(p)])).catch(() => {});
      return res.status(400).json({ error: 'Formato de imagem não suportado. Use PNG, JPG, WEBP ou GIF (até 5 MB).' });
    }

    try {
      const skin = await store.createSkin({ name, code, author, description, tags, images });
      res.status(201).json(skin);
    } catch (e) {
      // Caminho já usado por outra skin.
      if (/skin_images_path_key|duplicate key/.test(e.message)) {
        return res.status(400).json({ error: 'Imagens inválidas. Tente enviar de novo.' });
      }
      throw e;
    }
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
