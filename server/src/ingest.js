'use strict';

/*
 * RAG ingestion CLI.
 *   node src/ingest.js <folder-path>
 *   OBSIDIAN_VAULT=/path/to/folder node src/ingest.js
 *
 * Loads every supported document under the folder (.md, .txt, .pdf), chunks
 * them, embeds the chunks (EMBEDDINGS_PROVIDER), and upserts them into the
 * vector store (VECTOR_STORE). Re-running merges by id, so you can ingest a
 * vault and a PDFs folder separately and they accumulate.
 */

const documents = require('./documents');
const embeddings = require('./embeddings');
const store = require('./vectorstore');

async function main() {
  const folder = process.argv[2] || process.env.OBSIDIAN_VAULT;
  if (!folder) {
    console.error('Usage: node src/ingest.js <folder-path>   (.md, .txt, .pdf — or set OBSIDIAN_VAULT)');
    process.exit(1);
  }
  console.log(`Loading documents from: ${folder}`);
  const items = documents.loadDocuments(folder);
  console.log(`Found ${items.length} chunks. Embedding via "${embeddings.PROVIDER}"…`);
  if (!items.length) { console.log('Nothing to ingest.'); return; }

  const batch = 96;
  const records = [];
  for (let i = 0; i < items.length; i += batch) {
    const slice = items.slice(i, i + batch);
    const vectors = await embeddings.embed(slice.map((s) => s.text));
    slice.forEach((s, j) => records.push({ id: s.id, vector: vectors[j], text: s.text, meta: s.meta }));
    console.log(`  embedded ${records.length}/${items.length}`);
  }
  // Single upsert -> one write/upload for the whole index.
  await store.upsert(records);
  console.log(`Done. Vector store "${store.BACKEND}" now holds ${await store.count()} chunks.`);
}

main().catch((e) => { console.error('Ingest failed:', e.message); process.exit(1); });
