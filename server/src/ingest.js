'use strict';

/*
 * RAG ingestion CLI.
 *   node src/ingest.js <vault-path>
 *   OBSIDIAN_VAULT=/path/to/vault node src/ingest.js
 *
 * Loads an Obsidian vault, chunks each note, embeds the chunks
 * (EMBEDDINGS_PROVIDER), and upserts them into the vector store (VECTOR_STORE).
 */

const obsidian = require('./obsidian');
const embeddings = require('./embeddings');
const store = require('./vectorstore');

async function main() {
  const vault = process.argv[2] || process.env.OBSIDIAN_VAULT;
  if (!vault) {
    console.error('Usage: node src/ingest.js <vault-path>   (or set OBSIDIAN_VAULT)');
    process.exit(1);
  }
  console.log(`Loading vault: ${vault}`);
  const items = obsidian.loadVault(vault);
  console.log(`Found ${items.length} chunks. Embedding via "${embeddings.PROVIDER}"…`);
  if (!items.length) { console.log('Nothing to ingest.'); return; }

  const batch = 96;
  let done = 0;
  for (let i = 0; i < items.length; i += batch) {
    const slice = items.slice(i, i + batch);
    const vectors = await embeddings.embed(slice.map((s) => s.text));
    await store.upsert(slice.map((s, j) => ({ id: s.id, vector: vectors[j], text: s.text, meta: s.meta })));
    done += slice.length;
    console.log(`  embedded ${done}/${items.length}`);
  }
  console.log(`Done. Vector store "${store.BACKEND}" now holds ${await store.count()} chunks.`);
}

main().catch((e) => { console.error('Ingest failed:', e.message); process.exit(1); });
