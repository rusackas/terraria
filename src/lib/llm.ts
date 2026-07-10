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
  // Default: `claude -p` — real Claude on your subscription, no API tokens. We
  // never silently use the paid API just because a key is present; set
  // TERRARIA_LLM=anthropic for that, or TERRARIA_LLM=ollama for a local model.
  return "cli";
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

/** Generate text. Returns null when no backend is available, the per-tick budget
 *  is exhausted, or the call fails (callers then skip the content). */
export async function generate(prompt: string, maxTokens = 120): Promise<string | null> {
  const b = backend();
  if (b === "off" || overBudget()) return null;
  used++;
  return withSlot(() => {
    if (b === "ollama") return viaOllama(prompt, maxTokens);
    if (b === "cli") return viaCli(prompt);
    return viaAnthropic(prompt, maxTokens);
  });
}
