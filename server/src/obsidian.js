'use strict';

/*
 * Obsidian vault loader + chunker for RAG ingestion.
 *
 * Walks a vault directory, reads Markdown notes, strips YAML frontmatter and
 * Obsidian-specific syntax, and splits each note into overlapping chunks that
 * carry source metadata (note title, relative path, heading trail).
 *
 * No dependencies — plain fs + string processing.
 */

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

/** Recursively collect .md files under a vault directory. */
function findMarkdown(dir, root = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) findMarkdown(full, root, out);
    } else if (entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

/** Strip YAML frontmatter; return { body, frontmatter }. */
function splitFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: raw, frontmatter: {} };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { body: raw.slice(m[0].length), frontmatter: fm };
}

/** Convert Obsidian/Markdown to clean plain text for embedding. */
function toPlainText(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')                 // code fences
    .replace(/`[^`]*`/g, ' ')                          // inline code
    .replace(/!\[\[[^\]]*\]\]/g, ' ')                  // embedded attachments
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')      // [[link|alias]] -> alias
    .replace(/\[\[([^\]]+)\]\]/g, '$1')                 // [[link]] -> link
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')              // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')            // [text](url) -> text
    .replace(/^>\s?/gm, '')                             // blockquotes
    .replace(/[*_~]{1,3}/g, '')                         // emphasis markers
    .replace(/^#{1,6}\s+/gm, '')                        // heading hashes
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Split text into ~maxChars chunks on paragraph boundaries, with overlap.
 * Heading lines are tracked so each chunk records the section it came from.
 */
function chunkNote(body, { maxChars = 1400, overlap = 200 } = {}) {
  const blocks = body.split(/\n{2,}/);
  const chunks = [];
  let buf = '';
  let heading = '';
  let curHeading = '';
  const flush = () => {
    const text = toPlainText(buf).trim();
    if (text.length >= 40) chunks.push({ text, heading: curHeading });
    buf = '';
  };
  for (const block of blocks) {
    const h = block.match(/^#{1,6}\s+(.+)$/m);
    if (h) heading = h[1].trim();
    if (buf && (buf.length + block.length) > maxChars) {
      curHeading = heading;
      const tail = buf.slice(-overlap);
      flush();
      buf = tail + '\n\n';
    }
    curHeading = heading;
    buf += block + '\n\n';
  }
  flush();
  return chunks;
}

/**
 * Load and chunk an entire vault.
 * Returns [{ id, text, meta: { title, path, heading } }].
 */
function loadVault(vaultDir, opts = {}) {
  const root = path.resolve(vaultDir);
  if (!fs.existsSync(root)) throw new Error(`Vault not found: ${root}`);
  const files = findMarkdown(root);
  const items = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const { body } = splitFrontmatter(raw);
    const rel = path.relative(root, file);
    const title = path.basename(file, path.extname(file));
    const chunks = chunkNote(body, opts);
    chunks.forEach((c, i) => {
      items.push({
        id: `${rel}#${i}`,
        text: c.text,
        meta: { title, path: rel, heading: c.heading || '' },
      });
    });
  }
  return items;
}

module.exports = { loadVault, findMarkdown, chunkNote, toPlainText, splitFrontmatter };
