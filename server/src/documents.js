'use strict';

/*
 * Document loader for RAG ingestion. Walks a folder and turns each supported
 * file into embeddable chunks (reusing the Obsidian chunker). Supports:
 *   .md  — Markdown / Obsidian notes (frontmatter stripped)
 *   .txt — plain text
 *   .pdf — text extracted via `pdftotext` (poppler-utils); scanned/image-only
 *          PDFs fall back to OCR (pdftoppm + tesseract) when available
 *
 * Extraction shells out to external tools so the project keeps zero npm
 * dependencies (the server already spawns external tools). If a tool is
 * missing, a clear install hint is given.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chunkNote, splitFrontmatter } = require('./obsidian');

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);
const SUPPORTED = /\.(md|txt|pdf)$/i;

// OCR fallback tuning (used only for PDFs with no usable text layer).
const OCR_LANGS = process.env.OCR_LANGS || 'eng+chi_sim+chi_tra';
const OCR_DPI = Number(process.env.OCR_DPI || 200);
const OCR_MAX_PAGES = Number(process.env.OCR_MAX_PAGES || 300);
// Below this many non-whitespace chars the "text layer" is considered junk
// (page numbers, watermark) and OCR is attempted instead.
const TEXT_LAYER_MIN_CHARS = Number(process.env.TEXT_LAYER_MIN_CHARS || 100);

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

function pdfToText(buffer, label) {
  try {
    // Read the PDF from stdin so this works for both local files and downloads.
    return execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', '-nopgbrk', '-', '-'],
      { input: buffer, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error('PDF support needs "pdftotext" (poppler). Install it: macOS `brew install poppler`, Debian/Ubuntu `apt-get install -y poppler-utils`.');
    }
    throw new Error(`pdftotext failed on ${label}: ${e.message}`);
  }
}

/** OCR a scanned PDF: render pages to images (pdftoppm), then tesseract each.
 *  Throws with an install hint if tesseract isn't available. */
function ocrPdf(buffer, label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qms-ocr-'));
  try {
    const pdf = path.join(tmp, 'doc.pdf');
    fs.writeFileSync(pdf, buffer);
    execFileSync('pdftoppm', ['-png', '-gray', '-r', String(OCR_DPI), '-l', String(OCR_MAX_PAGES), pdf, path.join(tmp, 'pg')],
      { stdio: 'ignore', timeout: 600000 });
    const pages = fs.readdirSync(tmp).filter((f) => f.startsWith('pg') && f.endsWith('.png')).sort();
    let out = '';
    for (const p of pages) {
      try {
        out += execFileSync('tesseract', [path.join(tmp, p), 'stdout', '-l', OCR_LANGS, '--psm', '3'],
          { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] }) + '\n';
      } catch (e) {
        if (e.code === 'ENOENT') {
          throw new Error('OCR needs "tesseract". Install it: Debian/Ubuntu `apt-get install -y tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-chi-tra`, macOS `brew install tesseract tesseract-lang`.');
        }
        console.warn(`  OCR: page ${p} of ${label} failed (${e.message.slice(0, 80)}) — continuing`);
      }
    }
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Extract plain text from an in-memory file (used for bucket downloads). */
function extractBuffer(filename, buffer) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.md') return splitFrontmatter(buffer.toString('utf8')).body;
  if (ext === '.txt') return buffer.toString('utf8');
  if (ext === '.pdf') {
    const label = path.basename(filename);
    const text = pdfToText(buffer, label);
    if (text && text.replace(/\s+/g, '').length >= TEXT_LAYER_MIN_CHARS) return text;
    // Little or no text layer — likely a scanned/image PDF. Try OCR.
    try {
      console.warn(`  "${label}" has no usable text layer — running OCR (${OCR_LANGS})…`);
      const ocr = ocrPdf(buffer, label);
      if (ocr && ocr.trim()) return ocr;
    } catch (e) {
      console.warn(`  OCR unavailable/failed for ${label}: ${e.message}`);
    }
    return text;
  }
  return '';
}

function extractText(file) {
  return extractBuffer(file, fs.readFileSync(file));
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

module.exports = { loadDocuments, findDocs, extractText, extractBuffer };
