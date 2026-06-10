# 奇门超能 · Qi Men Superpowers

**BaZi (八字 Four Pillars) × Qi Men Dun Jia (奇门遁甲) web application** — long-term
destiny analysis meets short-term time-space strategy, in one interface.

The app wraps the open-source [qmenpowers](https://github.com/skyfiredao/qmenpowers)
pure-Bash Qi Men Dun Jia engine (vendored in [`engine/`](engine/), GPL-3.0,
Zhi-Run 置闰 method, hourly rotating-plate 时家转盘奇门) behind a
zero-dependency Node.js API server, derives full BaZi analysis from the same
calendar math, and renders everything in a bilingual (中文 / English) web UI.

## Features

**BaZi 八字**
- Four Pillars chart (year/month/day/hour stems & branches) — computed by the
  engine's own calendar conversion, so BaZi and Qi Men always agree
- Hidden stems (藏干), Ten Gods (十神) with English names
- Five-Elements balance with hidden-stem weighting, rendered as bars
- Day Master strength estimate (seasonal state 旺相休囚死 + support ratio)
- 10-year Luck Pillars (大运) with direction and starting age from solar terms
- Optional [Astrology-API.io Luck Pillars](https://astrology-api.io/p/luck-pillars)
  precision mode (set `ASTROLOGY_API_KEY`)

**Qi Men Dun Jia 奇门遁甲**
- Interactive nine-palace plate (birth plates 出生局 and event plates 问事局):
  deities, stars, gates, heaven/earth stems, twelve states, and condition
  markers (空亡 / 驿马 / 击刑 / 门迫 / 入墓 / 伏吟 / 反吟), with 值符/值使 highlighted
- Click any palace for full Wan Wu 万物类象 correspondences (colors, objects,
  directions, animals…)
- True solar time correction 真太阳时 (longitude + equation of time) applied
  before plate setting when a longitude is provided

**Analysis modules** (each returns narrative text + structured JSON):

| Tab | Engine module | What it does |
|---|---|---|
| 财官 Wealth·Career | `qimen_caiguan.sh` | Seven wealth hazards, six-harm detection, monthly-decree relations, industry symbols |
| 婚恋 Romance | `qimen_hunlian.sh` | Partner combinations, peach-blossom 桃花, lonely-star patterns |
| 性格 Personality | `qimen_xingge.sh` | Inner/outer personality from day & hour stem palaces |
| 问事 Event | `qimen_event.sh` | Nine standard question types (事业/求财/婚姻感情/…) read from an event plate |
| 占断 Divination | `qimen_zhanduan.sh` | Ancient *Qi Men Zhi Gui* judgment rules evaluated against the event plate |
| 遥测 Yaoce | `qimen_yaoce.sh` | Cross-plate sensing: birth-plate protected stems placed on the event plate |
| 寻时 Timing | `qimen_xunshijieyun.sh` | 60 Gan-Zhi variant plates ranked by six-harm count — best time windows |
| 化气阵 Array | `qimen_huaqizhen.sh` | Per-palace array-placement plans to suppress harmful energies |
| 移神换将 Remedy | `qimen_yishenhuanjiang.sh` | Transformation remedies: removal, combination, drainage, clash |

**问答 Ask — conversational interpreter** (optional)
- Streaming chat that answers BaZi/Qi Men questions, grounded in your most
  recently computed reading and an optional knowledge base
- Free in-browser **voice**: speak questions (Web Speech `SpeechRecognition`)
  and have replies read aloud (`speechSynthesis`), following the 中文/EN toggle
- **Pluggable, non-Anthropic providers** chosen by env vars — works offline out
  of the box (no keys) and scales up to OpenAI + a hosted knowledge base
- **RAG** over an [Obsidian](https://obsidian.md) vault: notes are chunked,
  embedded, and retrieved per question; the source notes used are shown as tags

## Quick start

Requires **Node.js ≥ 18** and **Bash** (the engine has zero other dependencies — no npm install needed).

```bash
node server/src/index.js
# → http://localhost:8787
```

Or with Docker:

```bash
docker compose up --build
```

Optional precision mode: `cp .env.example .env`, add your `ASTROLOGY_API_KEY`,
and export it before starting (or let docker-compose pass it through).

## API

| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/health` | – | engine info, module & question lists |
| `POST /api/bazi` | `{ birth: "YYYY-MM-DD HH:MM", gender: "male"\|"female", longitude?, tzOffset? }` | pillars, ten gods, five elements, strength, luck pillars, optional `external` API data |
| `POST /api/qimen/plate` | `{ datetime, type: "birth"\|"event", tianqin?, longitude?, tzOffset? }` | full plate JSON + `plateId` |
| `POST /api/qimen/analyze` | `{ module, birth?, eventTime?, question?, topic?, yixiang?, familyStems?, tianqin?, longitude?, tzOffset? }` | `{ text, data, birthPlate?, eventPlate?, plateId }` |
| `POST /api/qimen/wanwu` | `{ plateId, palace }` or `{ stem?/star?/gate?/deity?/state? }` | correspondence text + JSON |
| `POST /api/chat` | `{ messages:[{role,content}], context?, lang? }` | **SSE stream** of `{type:"token"\|"sources"\|"done"\|"error", …}` |

When `longitude` is supplied, datetimes are corrected to true solar time before
plate setting and the correction is echoed back (`solarCorrection`).

Deterministic computations (plates, module runs, BaZi) are cached in memory
for 10 minutes; cached plates power the palace-click Wan Wu lookups.

## Conversational interpreter (问答 Ask)

The **Ask** tab is optional and degrades gracefully: with no configuration it
runs a `stub` provider (an offline canned stream) so the UI, streaming, and
voice all work without any keys. Three independent pieces are each chosen by an
environment variable.

**1 · Language model** — `LLM_PROVIDER`
- `stub` (default) — offline, no keys
- `openai` — any OpenAI-compatible `/chat/completions` gateway. Set
  `OPENAI_API_KEY`, optional `OPENAI_BASE_URL` (default `https://api.openai.com/v1`)
  and `OPENAI_MODEL` (default `gpt-4o-mini`).

**2 · Embeddings** — `EMBEDDINGS_PROVIDER`
- `hash` — offline deterministic vectorizer (no keys; used for tests/fallback)
- `openai` (default when `OPENAI_API_KEY` is set) — `text-embedding-3-small`

**3 · Vector store** — `VECTOR_STORE`
- `local` (default) — the index is a JSON file (`VECTOR_FILE`, gitignored);
  in-process cosine search
- `insforge` — the index is persisted as one JSON blob in an
  [InsForge](https://insforge.dev) storage bucket and loaded on boot (durable
  across the ephemeral deploy container); cosine search runs in-process, which
  is ideal for a personal vault's scale. Set `INSFORGE_BASE_URL` (your project
  URL), `INSFORGE_API_KEY` (sent as `x-api-key`), `INSFORGE_BUCKET`, and optional
  `INSFORGE_OBJECT` (default `qms_vectors.json`).

Retrieval is automatic: `/api/chat` embeds the latest question, pulls the top
matching chunks, injects them as grounding context, and streams a `sources`
event listing the notes used. The system prompt forbids inventing chart
calculations, so answers stay anchored to the computed reading and the corpus.

### Building the knowledge base from an Obsidian vault

```bash
cd server
npm run insforge:check                 # validate InsForge creds + bucket (if used)
npm run ingest -- /path/to/your/vault  # chunk -> embed -> upsert the index
```

`GET /api/health` reports the live chat config and the loaded chunk count under
`chat`. See `.env.example` for the full list of variables.

## Architecture

```
web/        static bilingual frontend (no build step) — nine-palace grid,
            BaZi pillars, five-element bars, luck-pillar timeline, module tabs
server/     zero-dependency Node HTTP server
  src/index.js   routes, static serving, response cache, /api/chat SSE
  src/qimen.js   engine wrapper — per-request temp dirs around the bash CLIs
  src/bazi.js    Ten Gods / hidden stems / five elements / strength / luck pillars
  src/solar.js   true solar time + Jie 节 solar-term approximation (±1 day)
  src/llm.js          chat provider adapter (stub | openai-compatible)
  src/embeddings.js   embeddings adapter (hash | openai)
  src/vectorstore.js  vector index + cosine search (local | insforge storage)
  src/obsidian.js     Obsidian vault loader + chunker
  src/ingest.js       CLI: vault -> chunk -> embed -> upsert
engine/     vendored qmenpowers (GPL-3.0) — pure-Bash plate engine + modules
```

Every API request that touches the engine runs in its own temp directory,
because the engine modules communicate through CWD-relative JSON files
(`qmen_birth.json`, `qmen_event.json`, `qmen_<module>.json`) — this makes
concurrent requests safe.

## Tests

```bash
cd server && npm test
```

The smoke test exercises plate generation, all nine analysis modules, Wan Wu
lookups, BaZi derivation (including known-answer checks for the 1990-05-15
chart), solar utilities, and input validation.

## Notes & limits

- Luck-pillar starting age uses a century-constant solar-term approximation
  (±1 day ⇒ at most ~4 months of start-age drift). Enable the Astrology-API
  integration for ephemeris-grade precision.
- The Astrology-API.io request/response shape is configurable via
  `ASTROLOGY_API_URL`; consult their docs for your plan's exact endpoint. The
  external call is best-effort — local analysis always works without it.
- 仅供文化研究与娱乐参考。For cultural study and entertainment only — not
  professional, financial, medical, or legal advice.

## License

The vendored engine (`engine/`) is GPL-3.0 by the
[qmenpowers](https://github.com/skyfiredao/qmenpowers) authors; this
application is therefore distributed under **GPL-3.0** as well.
