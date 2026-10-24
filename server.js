const path = require('node:path');
const { openDatabase } = require('./src/db');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

const db = openDatabase(path.join(DATA_DIR, 'skins.db'));
const app = createApp({
  db,
  uploadsDir: path.join(DATA_DIR, 'uploads'),
  adminToken: process.env.ADMIN_TOKEN || '',
});

app.listen(PORT, () => {
  console.log(`Just Volleyball Skins rodando em http://localhost:${PORT}`);
});
