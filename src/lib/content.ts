// Content generation for posts and comments. Templated by default (always works,
// offline). If an AI Gateway key is configured, LLM output is used instead.

import { RNG } from "./rng";
import { TOPICS } from "./data";

export interface PersonaLike {
  firstName: string;
  occupation: string;
  city: string;
  interests: string[];
  extraversion: number;
  neuroticism: number;
  openness: number;
  agreeableness: number;
  age: number;
}

const llmEnabled = () => !!process.env.AI_GATEWAY_API_KEY;
const MODEL = process.env.TERRARIA_MODEL || "openai/gpt-4o-mini";

async function llm(prompt: string, maxTokens = 120): Promise<string | null> {
  if (!llmEnabled()) return null;
  try {
    const { generateText } = await import("ai");
    const { text } = await generateText({
      model: MODEL,
      prompt,
      maxOutputTokens: maxTokens,
      temperature: 0.9,
    });
    return text.trim().replace(/^["']|["']$/g, "");
  } catch (err) {
    console.warn("[terraria] LLM call failed, falling back to template:", (err as Error).message);
    return null;
  }
}

// ---- Post generation ----------------------------------------------------

const STATUS_TEMPLATES = [
  (r: RNG, p: PersonaLike) => `Spent the afternoon on ${r.pick(p.interests)}. Exactly what I needed.`,
  (r: RNG, p: PersonaLike) => `Some days ${p.occupation === "student" ? "studying" : `being a ${p.occupation}`} in ${p.city} is a lot. Today was one of them.`,
  (r: RNG, p: PersonaLike) => `Thinking about picking ${r.pick(p.interests)} back up. Anyone else into it?`,
  (r: RNG, p: PersonaLike) => `${p.city} is doing that thing again where the whole city feels like a movie set. I love it here.`,
  (r: RNG) => `Reminder to self: ${r.pick(["drink water", "call your mom", "go outside", "log off earlier", "start that thing you keep putting off"])}.`,
  (r: RNG, p: PersonaLike) => `Hot take: ${r.pick(p.interests)} is criminally underrated.`,
  (r: RNG, p: PersonaLike) => `Small win today. Won't bore you with details, but it mattered to me.`,
];

const OPINION_TEMPLATES = [
  (r: RNG, p: PersonaLike) => `I keep coming back to this: ${r.pick(p.interests)} teaches you more about patience than anything else.`,
  (r: RNG) => `Unpopular opinion, but the old way was better. Fight me (gently).`,
  (r: RNG, p: PersonaLike) => `Been chewing on ${r.pick(TOPICS)}. Not sure where I land yet, honestly.`,
];

const MILESTONE_TEMPLATES = [
  (r: RNG, p: PersonaLike) => `Big news — ${r.pick(["new chapter starting", "made a decision I've been sitting on for months", "finally did the thing"])}. More soon.`,
];

export async function makePost(
  seed: string,
  persona: PersonaLike,
  kind: string,
): Promise<{ text: string; topic: string | null }> {
  const r = new RNG(seed);
  const topic = r.pick(TOPICS);

  const prompt = `You are ${persona.firstName}, a ${persona.age}-year-old ${persona.occupation} in ${persona.city}. Interests: ${persona.interests.join(", ")}. Write a single short, natural social-media post (max 2 sentences, first person, no hashtags unless it fits) about ${topic}. Personality: ${describeTraits(persona)}. Just the post text.`;

  const llmText = await llm(prompt);
  if (llmText) return { text: llmText, topic };

  const pool =
    kind === "opinion" ? OPINION_TEMPLATES
    : kind === "milestone" ? MILESTONE_TEMPLATES
    : STATUS_TEMPLATES;
  return { text: r.pick(pool)(r, persona), topic };
}

// ---- Comment generation -------------------------------------------------

const COMMENT_TEMPLATES = [
  (r: RNG) => r.pick(["So true.", "Love this.", "Needed to hear this today.", "Couldn't agree more."]),
  (r: RNG) => r.pick(["Tell me more!", "Wait, say more about this.", "Ok now I'm curious."]),
  (r: RNG, p: PersonaLike) => `As someone also into ${r.pick(p.interests)}, yes. A thousand times yes.`,
  (r: RNG) => r.pick(["Sending good vibes ❤️", "Rooting for you.", "You've got this."]),
  (r: RNG) => r.pick(["Respectfully disagree, but I see your point.", "Hmm, not sure I'm sold, but interesting."]),
];

export async function makeComment(
  seed: string,
  commenter: PersonaLike,
  postText: string,
  authorName: string,
): Promise<string> {
  const r = new RNG(seed);
  const prompt = `You are ${commenter.firstName}. Your friend ${authorName} posted: "${postText}". Write a single short, genuine reply (max 1 sentence). Personality: ${describeTraits(commenter)}. Just the reply.`;
  const llmText = await llm(prompt, 60);
  if (llmText) return llmText;
  return r.pick(COMMENT_TEMPLATES)(r, commenter);
}

function describeTraits(p: PersonaLike): string {
  const t: string[] = [];
  t.push(p.extraversion > 0.6 ? "outgoing" : p.extraversion < 0.35 ? "reserved" : "even-keeled");
  if (p.neuroticism > 0.6) t.push("a bit anxious");
  if (p.agreeableness > 0.6) t.push("warm");
  if (p.openness > 0.6) t.push("curious");
  return t.join(", ");
}
