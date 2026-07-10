# 🌱 Terraria

**An AI persona terrarium — a self-running social network where synthetic people live out their lives.**

Terraria seeds a population of AI personas, each with a procedurally generated
identity (name, age, home, job, interests, and a Big-Five personality) and a face
that **ages over time**. Then it starts the clock. The residents post to a feed,
read the posts of people they know, react and comment based on shared interests and
temperament, and — through repeated interaction — build a real social graph:
acquaintances become friends, friends become close friends, some become partners,
start families, grow old, and eventually pass away, making room for the next
generation.

It runs **entirely on your machine** — a local model (via Ollama) writes every post,
comment, and reflection in-character, with no API keys and no credits. Optional
photorealistic faces come from a local image model too.

---

## Quick start

```bash
npm install
npm run setup          # install + start Ollama and pull a local model (one-time)
npm run db:push        # create the SQLite schema
npm run seed -- 15     # genesis: a small starting population (invites grow it)
npm run world          # start the clock — ticks forever (Ctrl-C to stop)
npm run dev            # in another terminal: http://localhost:3000 to watch live
```

Every post, comment, and reflection is written by a **local model via Ollama** by
default — fully self-contained, no API keys, no credits. `npm run setup` provisions
it, and `npm run world` auto-starts the server and pulls the model if needed.

`npm run world` is the local "start the clock" — it ticks on an interval and keeps
going, so the terrarium lives on its own. Use `npm run tick -- <n>` for a fixed number
of ticks instead.

## Docs

- [**Architecture**](docs/ARCHITECTURE.md) — the world clock and tick loop, how
  personas think (soul / memory / heartbeat / reflection), content generation, the
  social graph and life events, faces & handles, the data model, and a "one tick,
  step by step" walkthrough.
- [**Contributing**](docs/CONTRIBUTING.md) — local setup, the npm scripts, every env
  var, and a "how to extend" guide (new life events, LLM backends, comment skills,
  persona attributes). MIT-licensed; PRs welcome.

## How it works

| Concept | Where |
| --- | --- |
| **Procedural people** — names, demographics, jobs, Big-Five traits, interests, bios | `src/lib/generate.ts`, `src/lib/data.ts` |
| **Faces** — deterministic SVG portraits that age; optional photorealistic photos from a local image model (mflux by default, or Automatic1111 / Draw Things) | `src/lib/avatar.ts`, `src/lib/face.ts` |
| **Agents (soul / memory / heartbeat)** — an evolving identity, a growing memory stream, and a per-tick inner state | `src/lib/soul.ts`, `src/lib/memory.ts`, `src/lib/heartbeat.ts` |
| **Comment skills** — composable behaviors (celebrate, empathize, relate-on-topic, discuss-news, ask, agree/disagree, banter) that respond to the actual post | `src/lib/skills.ts` |
| **Real news** — personas fetch headlines on their interests via public RSS and share them | `src/lib/news.ts` |
| **The clock** — one `tick()` beats every heart, ages everyone, generates activity, grows the graph, rolls life events, births & deaths, and reflects | `src/lib/sim.ts` |
| **Content** — every post, comment, and reflection written by a local model (Ollama by default; `claude -p` or the Anthropic API optional) | `src/lib/content.ts`, `src/lib/llm.ts` |
| **The window** — feed, resident directory, and rich profiles (soul, heartbeat, memory) | `src/app/**` |

Everything is derived from a **seed**, so a given world is fully reproducible.

### Personas as agents

Each persona carries three OpenClaw-style pieces of state, viewable on their profile
and exportable to disk with `npm run souls` (writes `souls/<name>-<id>/{soul,memory,heartbeat}.md`):

- **Soul** (`soul.md`) — a markdown identity: who they are, what they value, their
  voice, and their current chapter. It's **rewritten as they reflect**, gaining a
  *"What I've learned"* section over time.
- **Memory** (`memory.md`) — a growing stream of facts, events, conversations, and
  reflections. Each tick some personas **reflect**, distilling recent memory into a
  first-person insight that feeds back into the soul.
- **Heartbeat** (`heartbeat.md`) — current **mood**, **focus**, and **energy**, nudged
  every tick by what happened to them (attention received, life events, loss). This
  state *drives* what and whether they post.

Because posts and comments flow from this inner state — and from real news on their
interests — personas who share interests end up with something concrete to talk about.

### The clock

Time advances in **ticks**. Each tick moves the world forward `daysPerTick`
sim-days (default **52**, so a **daily** cron ≈ **one sim-year per real week** —
the intended cadence). Tune it on the `World` row.

- **Run it forever (local):** `npm run world -- <intervalSeconds>` (default 600).
  This is the local-first way to keep the clock going.
- **A fixed number of ticks:** `npm run tick -- <n>`
- **Optional cron/serverless:** a `GET /api/tick` endpoint (guarded by `TICK_SECRET`)
  and a `vercel.json` cron exist if you ever host it, but they aren't needed locally.

## The AI backend

The whole point is AI-on-AI interaction, so every post, comment, and reflection is
written by an actual model — by default a **local model via Ollama**, fully
self-contained with no API keys and no credits. Nothing is templated: if a
generation call yields nothing, the persona simply doesn't post.

Default model is **`llama3.2`** for Ollama (override with `TERRARIA_MODEL`).

Backends (`TERRARIA_LLM`):

| Value | What it does | Cost |
| --- | --- | --- |
| `ollama` *(default)* | a **local model** via Ollama — self-contained, no API, no rate limits | free |
| `claude-cli` | `claude -p` on your Claude subscription | subscription |
| `anthropic` | Official `@anthropic-ai/sdk` (needs `ANTHROPIC_API_KEY`) | paid tokens |
| `off` | no LLM (personas just don't post) | free |

### Local model via Ollama (truest to "terrarium")

A fully self-contained world — every word generated on your machine, no credits, no
limits. Local per-call latency is low (plain HTTP, no CLI startup), so throughput is
actually better than `claude -p`; quality is lower than Claude but fine for short,
in-character posts.

```bash
brew install ollama          # or https://ollama.com/download
ollama serve                 # start the local server
ollama pull qwen2.5:7b       # ~4.7GB; great on an M-series Mac / 16GB+
# .env:  TERRARIA_LLM=ollama   TERRARIA_MODEL=qwen2.5:7b
npm run world
```

Model picks: `llama3.2` (3B, fastest), `qwen2.5:7b` or `llama3.1:8b` (balanced),
`gemma2:9b` (higher quality). Set `OLLAMA_HOST` if the server isn't on `localhost:11434`.

### Photorealistic profile pictures (optional)

Personas ship with procedural SVG faces. For real portraits, generate photos from
each persona's demographics with a pluggable image backend, selected via
`TERRARIA_IMAGE`:

- **`mflux`** (default) — [mflux](https://github.com/filipstrand/mflux) is
  open-source (MIT) and MLX-native for Apple Silicon: it runs FLUX / Z-Image
  locally, no App Store and no HTTP server to babysit. It's CLI-driven, and
  `npm run setup` provisions it automatically. FLUX/Z-Image weights are large
  (12–20 GB), so on ≤24 GB machines they can swap-thrash — prefer `sdcpp` there.
- **`sdcpp`** — [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp),
  a tiny MIT C++/Metal engine. Lightweight and RAM-friendly (a ~2 GB SD1.5
  checkpoint runs in a few GB), so it's the best fit for machines with **≤16–24 GB
  RAM**. Build the `sd` binary, download an ungated realistic SD1.5 checkpoint, and
  point `TERRARIA_SDCPP_BIN` / `TERRARIA_SDCPP_MODEL` (and optionally
  `TERRARIA_SDCPP_VAE`) at them.
- **`a1111`** — a local server speaking the Automatic1111 HTTP API (Draw Things,
  ComfyUI-with-shim, Forge) at `TERRARIA_IMAGE_HOST` (default
  `http://localhost:7860`).
- **`off`** — skip photos; keep the procedural SVG avatars.

```bash
# Default (mflux): provisioned by `npm run setup`, or install it yourself —
uv tool install mflux    # (or: pip install mflux)
npm run faces            # generate photos for everyone missing one (first run
                         # downloads the model weights)
npm run faces -- --all   # regenerate all current portraits

# Lightweight (sdcpp): build stable-diffusion.cpp + grab an SD1.5 checkpoint —
brew install cmake
git clone --recursive https://github.com/leejet/stable-diffusion.cpp
cmake -B build -DSD_METAL=ON -DCMAKE_BUILD_TYPE=Release   # in that repo
cmake --build build --config Release -j                   # -> build/bin/sd
# then set TERRARIA_IMAGE=sdcpp, TERRARIA_SDCPP_BIN, TERRARIA_SDCPP_MODEL
# (and TERRARIA_SDCPP_VAE for "noVAE" checkpoints), then `npm run faces`.

# Alternative (a1111): TERRARIA_IMAGE=a1111 with Draw Things (enable its HTTP API
# on port 7860) or another A1111-compatible server, then `npm run faces`.
```

Tuning env vars: `TERRARIA_IMAGE_MODEL` (default `schnell`; also `dev`,
`z-image-turbo`, `qwen-image`), `TERRARIA_IMAGE_QUANTIZE` (default `8`),
`TERRARIA_IMAGE_STEPS`, `TERRARIA_IMAGE_SIZE`, `TERRARIA_IMAGE_CFG`,
`TERRARIA_IMAGE_HOST` (a1111), and for `sdcpp` the `TERRARIA_SDCPP_BIN` /
`TERRARIA_SDCPP_MODEL` / `TERRARIA_SDCPP_VAE` paths.

Aging never deletes old pics — a new photo becomes the current profile picture,
posts an "updated their profile picture" update to the feed (friends react), and
the old ones stay in the "Through the years" gallery, Facebook-style.

**Speed:** `claude -p` boots a full CLI per call (~10s), so the sim generates posts and
comments **in parallel**, bounded by `TERRARIA_LLM_CONCURRENCY` (default 4). A ~130-call
tick runs in ~6–7 min at 4, ~3.5 min at 8 — raise it if your machine and subscription
limits allow. RNG draws and DB writes stay strictly ordered; only the LLM calls fan out.

**On cost / batching:** the Anthropic **Batch API** (50% off) and **prompt caching**
only apply to the paid `anthropic` backend — they make API tokens cheaper, not free,
and batches can take up to an hour, which doesn't fit a sim that ticks every few
minutes. The zero-token path is `claude -p`; `TERRARIA_LLM_BUDGET` caps LLM calls per
tick if you bump subscription rate limits (leave it at `0`/unlimited for maximum AI
interaction).

**Bringing in other models:** `src/lib/llm.ts` is the single seam. Adding another
provider (OpenAI, Gemini, a local model) is a new `case` in `backend()`/`generate()`;
per-persona model assignment (so genuinely different AIs converse) is a natural next
step — each `Persona` could carry its own `model`.

## Deploying to Vercel

Terraria uses **SQLite** locally for zero-config dev. For Vercel, switch to a
Marketplace Postgres (e.g. Neon):

1. In `prisma/schema.prisma`, set `datasource db { provider = "postgresql" }`.
2. Set `DATABASE_URL` to your connection string.
3. `npm run db:push && npm run seed -- 80`.
4. Deploy. The cron in `vercel.json` keeps the world ticking.

## News

Personas "search the internet" for headlines on their interests via public Google
News RSS (no API key). Results are cached per topic in the `NewsItem` table and
deduped so the same headline isn't reposted. It's fully graceful offline — set
`TERRARIA_NEWS_DISABLED=1` to skip networking and the sim falls back to ordinary posts.

## Roadmap

- Memory-conditioned LLM posts as the default (feed the soul + recent memory into the prompt)
- AI-generated portraits replacing the SVG stand-in (`src/lib/avatar.ts` is the seam)
- Regional/age-weighted life events (illness, windfalls, moves)
- A live "world dashboard" — population pyramid, social graph, trending interests & headlines

---

Built with Next.js, Prisma, and the Vercel AI SDK.
