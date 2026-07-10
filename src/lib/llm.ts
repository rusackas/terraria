// LLM backend for persona content. Backends, selected via TERRARIA_LLM:
//
//   1. "ollama" — a local model via Ollama (http://localhost:11434). Fully
//      self-contained: no API, no credits, no rate limits. The truest fit for a
//      "terrarium." Fast per call (plain HTTP, no process startup). Model quality
//      is lower than Claude but fine for short in-character posts/comments.
//   2. "cli" — shells out to `claude -p` (Claude Code login/subscription, no API
//      tokens). Real Claude quality, but spawns a process per call (~10s startup).
//   3. "anthropic" — the official Anthropic SDK. Fast, but bills API tokens.
//   4. "off" — no LLM; callers skip the content (no templated filler).
//
// No AI Gateway key is required for any of these.

type Backend = "ollama" | "anthropic" | "cli" | "off";

// Model per backend. TERRARIA_MODEL overrides either (use a name valid for your
// chosen backend, e.g. "claude-haiku-4-5" for Claude, "qwen2.5:7b" for Ollama).
const MODEL = process.env.TERRARIA_MODEL || "claude-haiku-4-5"; // claude backends
const OLLAMA_MODEL = process.env.TERRARIA_MODEL || "llama3.2"; // ollama backend
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

export function backend(): Backend {
  const mode = process.env.TERRARIA_LLM?.toLowerCase();
  if (mode === "off") return "off";
  if (mode === "ollama") return "ollama";
  if (mode === "anthropic") return "anthropic";
  if (mode === "cli" || mode === "claude-cli") return "cli";
  // Default: a local Ollama model — fully self-contained, no credits, no limits.
  // `npm run setup` (and the runtime preflight) provision it automatically. Use
  // TERRARIA_LLM=claude-cli for Claude via your subscription, or =anthropic for the API.
  return "ollama";
}

export function llmAvailable(): boolean {
  return backend() !== "off";
}

// Optional cap on LLM calls per tick. A tick can generate ~130 posts+comments;
// capping keeps the `claude -p` path fast and bounds subscription/rate-limit use.
// 0 = unlimited. Beyond the cap, callers fall back to templated content.
const BUDGET = parseInt(process.env.TERRARIA_LLM_BUDGET || "0", 10);
let used = 0;

/** Reset the per-tick LLM budget. Call at the start of each tick. */
export function resetLlmBudget(): void {
  used = 0;
}

function overBudget(): boolean {
  return BUDGET > 0 && used >= BUDGET;
}

// Bounded concurrency. `claude -p` spawns a full CLI per call (~seconds of
// startup), so the sim fires calls in parallel — this caps how many run at once
// to keep memory/rate-limit use sane. Default 4; raise for more throughput if
// your machine (and subscription limits) can take it.
const CONCURRENCY = Math.max(1, parseInt(process.env.TERRARIA_LLM_CONCURRENCY || "4", 10));
let active = 0;
const waiters: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= CONCURRENCY) {
    await new Promise<void>((res) => waiters.push(res));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

// Lazy Anthropic client singleton (reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN).
let clientPromise: Promise<import("@anthropic-ai/sdk").default> | null = null;
async function anthropic() {
  if (!clientPromise) {
    clientPromise = import("@anthropic-ai/sdk").then((m) => new m.default());
  }
  return clientPromise;
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "");
}

async function viaAnthropic(prompt: string, maxTokens: number): Promise<string | null> {
  try {
    const client = await anthropic();
    // Note: no temperature — Opus 4.8/4.7 reject sampling params (400). Omitting
    // it keeps this valid across every model, including Haiku.
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return stripQuotes(text) || null;
  } catch (err) {
    console.warn("[terraria] Anthropic call failed, falling back to template:", (err as Error).message);
    return null;
  }
}

let cliMissing = false; // set once if the `claude` binary isn't found

// `claude -p` is the Claude Code coding agent — by default it reads the repo and
// will break character ("I'm here to help with software engineering"). Replacing
// its system prompt and running from a neutral dir turns it into a clean roleplay
// engine that stays in character.
const CLI_SYSTEM =
  "You are a creative-writing engine that voices fictional social-media personas for a simulation. " +
  "Given a persona and an instruction, reply ONLY with the requested in-character text. " +
  "No preamble, no surrounding quotation marks, no meta commentary, no offers to help. " +
  "Keep it very short — one sentence, at most two; never write paragraphs. " +
  "Never break character or mention being an AI, an assistant, or that this is a task.";

// Signs the model broke character despite the system prompt — discard if so.
const OFF_CHARACTER = /\b(as an AI|language model|I'?m here to help|software engineering|the (Terraria )?project|uncommitted|how can I (help|assist))\b/i;

async function viaCli(prompt: string): Promise<string | null> {
  if (cliMissing) return null;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const os = await import("node:os");
    const run = promisify(execFile);
    const { stdout } = await run(
      "claude",
      ["-p", prompt, "--model", MODEL, "--system-prompt", CLI_SYSTEM, "--exclude-dynamic-system-prompt-sections"],
      { timeout: 60_000, maxBuffer: 1024 * 1024, cwd: os.tmpdir() },
    );
    const text = stripQuotes(stdout);
    if (!text || OFF_CHARACTER.test(text)) return null;
    return text;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      cliMissing = true;
      console.warn(
        "[terraria] `claude` CLI not found. Install Claude Code, or set TERRARIA_LLM=anthropic. Using templates for now.",
      );
    } else {
      console.warn("[terraria] `claude -p` failed, using template:", (err as Error).message);
    }
    return null;
  }
}

let ollamaWarned = false;

async function viaOllama(prompt: string, maxTokens: number): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        system: CLI_SYSTEM, // same roleplay framing keeps the local model in character
        stream: false,
        options: { num_predict: maxTokens, temperature: 0.9 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 404 && !ollamaWarned) {
        ollamaWarned = true;
        console.warn(`[terraria] Ollama has no model "${OLLAMA_MODEL}". Run: ollama pull ${OLLAMA_MODEL}`);
      }
      void body;
      return null;
    }
    const data = (await res.json()) as { response?: string };
    const text = stripQuotes(data.response ?? "");
    if (!text || OFF_CHARACTER.test(text)) return null;
    return text;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (!ollamaWarned && (e.code === "ECONNREFUSED" || e.message?.includes("fetch failed"))) {
      ollamaWarned = true;
      console.warn(`[terraria] Ollama not reachable at ${OLLAMA_HOST}. Is it running? (\`ollama serve\`)`);
    } else if (e.name !== "AbortError") {
      console.warn("[terraria] Ollama call failed:", e.message);
    }
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function ollamaTags(): Promise<{ models?: { name: string }[] } | null> {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok ? ((await r.json()) as { models?: { name: string }[] }) : null;
  } catch {
    return null;
  }
}

/**
 * Make the Ollama backend usable before a run: start the server if it isn't up,
 * and pull the model if it's missing. No-op for other backends. Returns whether
 * the backend is ready plus a human note when it isn't.
 */
export async function ensureOllamaReady(): Promise<{ ok: boolean; note?: string }> {
  if (backend() !== "ollama") return { ok: true };
  const { execFile, spawn } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  let tags = await ollamaTags();
  if (!tags) {
    try {
      await run("ollama", ["--version"]);
    } catch {
      return { ok: false, note: "Ollama isn't installed. Run `npm run setup` (installs it and pulls a model)." };
    }
    // Start the server in the background and wait for it.
    spawn("ollama", ["serve"], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 24 && !tags; i++) {
      await sleep(500);
      tags = await ollamaTags();
    }
    if (!tags) return { ok: false, note: "Started `ollama serve` but couldn't reach it." };
  }

  const names = (tags.models ?? []).map((m) => m.name);
  const present = names.includes(OLLAMA_MODEL) || (!OLLAMA_MODEL.includes(":") && names.includes(`${OLLAMA_MODEL}:latest`));
  if (!present) {
    console.log(`[terraria] Pulling Ollama model "${OLLAMA_MODEL}" (first run — this downloads a few GB)…`);
    try {
      await new Promise<void>((resolve, reject) => {
        const c = spawn("ollama", ["pull", OLLAMA_MODEL], { stdio: "inherit" });
        c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ollama pull exited ${code}`))));
        c.on("error", reject);
      });
    } catch (e) {
      return { ok: false, note: `Couldn't pull "${OLLAMA_MODEL}": ${(e as Error).message}` };
    }
  }
  return { ok: true };
}

function dispatch(b: Backend, prompt: string, maxTokens: number): Promise<string | null> {
  if (b === "ollama") return viaOllama(prompt, maxTokens);
  if (b === "cli") return viaCli(prompt);
  if (b === "anthropic") return viaAnthropic(prompt, maxTokens);
  return Promise.resolve(null);
}

/** Generate text. Returns null when no backend is available, the per-tick budget
 *  is exhausted, or the call fails (callers then skip the content). */
export async function generate(prompt: string, maxTokens = 120): Promise<string | null> {
  const b = backend();
  if (b === "off" || overBudget()) return null;
  used++;
  return withSlot(() => dispatch(b, prompt, maxTokens));
}

// A persona's one-time "coming into existence" (bio/soul) can use a stronger model
// than the high-volume ongoing activity — set TERRARIA_SEED_LLM. Defaults to
// `claude-cli` (claude -p): better writing for the seed, while ticks stay on Ollama.
function seedBackend(): Backend {
  const mode = process.env.TERRARIA_SEED_LLM?.toLowerCase();
  if (mode === "off") return "off";
  if (mode === "ollama") return "ollama";
  if (mode === "anthropic") return "anthropic";
  if (mode === "cli" || mode === "claude-cli") return "cli";
  return "cli";
}

/** Generate one-time seed-profile content. Tries the seed backend (claude -p by
 *  default) and falls back to the regular activity backend if it's unavailable. */
export async function generateSeed(prompt: string, maxTokens = 160): Promise<string | null> {
  const b = seedBackend();
  if (b !== "off") {
    used++;
    const out = await withSlot(() => dispatch(b, prompt, maxTokens));
    if (out) return out;
  }
  return generate(prompt, maxTokens);
}
