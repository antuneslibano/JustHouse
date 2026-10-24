const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS skins (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      code        TEXT    NOT NULL,
      author      TEXT    NOT NULL DEFAULT '',
      description TEXT    NOT NULL DEFAULT '',
      copies      INTEGER NOT NULL DEFAULT 0,
      likes       INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS skin_images (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      skin_id  INTEGER NOT NULL REFERENCES skins(id) ON DELETE CASCADE,
      filename TEXT    NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS skin_tags (
      skin_id INTEGER NOT NULL REFERENCES skins(id) ON DELETE CASCADE,
      tag     TEXT    NOT NULL,
      PRIMARY KEY (skin_id, tag)
    );

    CREATE TABLE IF NOT EXISTS skin_likes (
      skin_id INTEGER NOT NULL REFERENCES skins(id) ON DELETE CASCADE,
      voter   TEXT    NOT NULL,
      PRIMARY KEY (skin_id, voter)
    );

    CREATE INDEX IF NOT EXISTS idx_skin_images_skin ON skin_images(skin_id, position);
    CREATE INDEX IF NOT EXISTS idx_skin_tags_tag ON skin_tags(tag);
  `);

  return db;
}

module.exports = { openDatabase };
