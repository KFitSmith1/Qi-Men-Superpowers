'use strict';

/*
 * Document loader for RAG ingestion. Walks a folder and turns each supported
 * file into embeddable chunks (reusing the Obsidian chunker). Supports:
 *   .md  — Markdown / Obsidian notes (frontmatter stripped)
 *   .txt — plain text
 *   .pdf — text extracted via `pdftotext` (poppler-utils)
 *
 * PDF extraction shells out to `pdftotext` so the project keeps zero npm
 * dependencies (the server already spawns external tools). If poppler isn't
 * installed, a clear install hint is thrown.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chunkNote, splitFrontmatter } = require('./obsidian');

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);
const SUPPORTED = /\.(md|txt|pdf)$/i;

function findDocs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) findDocs(full, out);
    } else if (SUPPORTED.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.md') return splitFrontmatter(fs.readFileSync(file, 'utf8')).body;
  if (ext === '.txt') return fs.readFileSync(file, 'utf8');
  if (ext === '.pdf') {
    try {
      return execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', '-nopgbrk', file, '-'],
        { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    } catch (e) {
      if (e.code === 'ENOENT') {
        throw new Error('PDF support needs "pdftotext" (poppler). Install it: macOS `brew install poppler`, Debian/Ubuntu `apt-get install -y poppler-utils`.');
      }
      throw new Error(`pdftotext failed on ${path.basename(file)}: ${e.message}`);
    }
  }
  return '';
}

/**
 * Load and chunk every supported document under a folder.
 * Returns [{ id, text, meta: { title, path, heading } }].
 */
function loadDocuments(dir, opts = {}) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) throw new Error(`Folder not found: ${root}`);
  const items = [];
  for (const file of findDocs(root)) {
    let body;
    try { body = extractText(file); }
    catch (e) { console.warn(`  skip ${path.relative(root, file)}: ${e.message}`); continue; }
    if (!body || !body.trim()) continue;
    const rel = path.relative(root, file);
    const title = path.basename(file, path.extname(file));
    chunkNote(body, opts).forEach((c, i) => {
      items.push({ id: `${rel}#${i}`, text: c.text, meta: { title, path: rel, heading: c.heading || '' } });
    });
  }
  return items;
}

module.exports = { loadDocuments, findDocs, extractText };
