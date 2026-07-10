// Personas pick their own social handle (username) via the LLM. Used in profile
// URLs (/people/<handle>) and shown as @handle.

import { generate } from "./llm";

export function sanitizeHandle(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 18);
}

export async function generateHandle(ctx: {
  firstName: string;
  occupation: string;
  interests: string[];
}): Promise<string | null> {
  const prompt = `You are ${ctx.firstName}, a ${ctx.occupation} into ${ctx.interests.slice(0, 3).join(", ")}. Invent a short, fun, personal social-media handle (a username) for yourself — lowercase, only letters, numbers and underscores, no spaces, 3–16 characters, no leading @, and not just your full name. Reply with ONLY the handle.`;
  const out = await generate(prompt, 24);
  if (!out) return null;
  const h = sanitizeHandle(out.split(/\s+/)[0] ?? "");
  return h.length >= 3 ? h : null;
}
