// LLM backend for persona content. Three backends, auto-selected:
//
//   1. "anthropic" — the official Anthropic SDK (@anthropic-ai/sdk). Fast,
//      retryable, works locally AND on Vercel. Used automatically when an
//      Anthropic key is present. This is the right engine for the sim, which
//      makes many short calls per tick.
//   2. "cli" — shells out to `claude -p`. Uses your existing Claude Code login
//      (no API key needed), but spawns a process per call, so it's slow at
//      volume and unavailable in serverless. Opt in with TERRARIA_LLM=claude-cli
//      for local runs.
//   3. "off" — no LLM; callers fall back to templated content.
//
// No AI Gateway key is required for any of these.

type Backend = "anthropic" | "cli" | "off";

// Haiku 4.5 — fast and cheap, the right fit for a terrarium generating hundreds
// of short posts/comments per tick. Override with TERRARIA_MODEL for a beefier
// model (e.g. claude-opus-4-8) if you want richer writing.
const MODEL = process.env.TERRARIA_MODEL || "claude-haiku-4-5";

export function backend(): Backend {
  const mode = process.env.TERRARIA_LLM?.toLowerCase();
  if (mode === "off") return "off";
  if (mode === "anthropic") return "anthropic";
  if (mode === "cli" || mode === "claude-cli") return "cli";
  // Default: `claude -p` — real AI content on your Claude subscription, no API
  // tokens. We never silently use the paid API just because a key is present;
  // set TERRARIA_LLM=anthropic to opt into that. Templates are error-only fallback.
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

async function viaCli(prompt: string): Promise<string | null> {
  if (cliMissing) return null;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run("claude", ["-p", prompt, "--model", MODEL], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    return stripQuotes(stdout) || null;
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

/** Generate text. Returns null when no backend is available, the per-tick budget
 *  is exhausted, or the call fails (callers then use templated content). */
export async function generate(prompt: string, maxTokens = 120): Promise<string | null> {
  const b = backend();
  if (b === "off" || overBudget()) return null;
  used++;
  return b === "cli" ? viaCli(prompt) : viaAnthropic(prompt, maxTokens);
}
