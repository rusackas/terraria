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

// Per skill guidance the default is Opus 4.8. For a terrarium generating
// hundreds of short posts/comments per tick, `claude-haiku-4-5` is far cheaper
// and faster — set TERRARIA_MODEL to switch.
const MODEL = process.env.TERRARIA_MODEL || "claude-opus-4-8";

function hasAnthropicKey(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function backend(): Backend {
  const mode = process.env.TERRARIA_LLM?.toLowerCase();
  if (mode === "off") return "off";
  if (mode === "anthropic") return "anthropic";
  if (mode === "cli" || mode === "claude-cli") return "cli";
  // auto: prefer the SDK when a key exists, otherwise stay templated.
  return hasAnthropicKey() ? "anthropic" : "off";
}

export function llmAvailable(): boolean {
  return backend() !== "off";
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

async function viaCli(prompt: string): Promise<string | null> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const args = ["-p", prompt];
    if (process.env.TERRARIA_MODEL) args.push("--model", process.env.TERRARIA_MODEL);
    const { stdout } = await run("claude", args, {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    return stripQuotes(stdout) || null;
  } catch (err) {
    console.warn("[terraria] `claude -p` failed, falling back to template:", (err as Error).message);
    return null;
  }
}

/** Generate text. Returns null when no backend is available or the call fails. */
export async function generate(prompt: string, maxTokens = 120): Promise<string | null> {
  switch (backend()) {
    case "anthropic":
      return viaAnthropic(prompt, maxTokens);
    case "cli":
      return viaCli(prompt);
    default:
      return null;
  }
}
