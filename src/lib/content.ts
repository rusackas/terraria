// Content generation — LLM only. There are no templates here: a persona's ongoing
// posts, comments, and reflections are always written by the model. If generation
// yields nothing (LLM off or a failed call), the caller simply skips that content
// rather than emitting canned filler. Only a persona's initial identity (name,
// demographics, bio, seed soul) is procedural — see generate.ts / soul.ts.

import { moodTone } from "./heartbeat";
import { generate, generateSeed } from "./llm";
import { extractSubject, skillInstruction, type CommentContext } from "./skills";

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

export interface Heartbeat {
  mood: string;
  focus: string;
}

// ---- Seed profile (one-time, uses the stronger seed backend) ------------

/** Write a persona's initial "about me" bio when they come into existence. */
export async function makeBio(p: {
  firstName: string;
  lastName: string;
  age: number;
  pronouns: string;
  occupation: string;
  city: string;
  country: string;
  interests: string[];
}): Promise<string | null> {
  const who =
    p.age < 13
      ? `a ${p.age}-year-old kid`
      : `a ${p.age}-year-old ${p.occupation}`;
  const prompt = `Invent a short social-media "about me" bio for a fictional person coming onto a social network: ${p.firstName} ${p.lastName}, ${who} in ${p.city}, ${p.country} (${p.pronouns}), into ${p.interests.slice(0, 4).join(", ")}. Write it in first person, 2–3 sentences, warm and specific with a hint of real personality and voice — like an actual person's profile bio, not a résumé or a list. Don't restate their name. Just the bio.`;
  return generateSeed(prompt, 160);
}

// ---- Posts --------------------------------------------------------------

export async function makePost(
  persona: PersonaLike,
  kind: string,
  hb?: Heartbeat,
): Promise<{ text: string; topic: string | null; imagePrompt: string | null } | null> {
  const focus = hb?.focus || persona.interests[0] || "life";
  const mood = hb?.mood ?? "content";

  const ask =
    kind === "milestone"
      ? "share a genuine, specific piece of personal good news or a life milestone"
      : kind === "opinion"
        ? `share a short honest opinion or something you've been turning over lately (maybe about ${focus})`
        : `post about your day, how you're feeling, or ${focus}`;

  const prompt = `You are ${persona.firstName}, a ${persona.age}-year-old ${persona.occupation} in ${persona.city}. Interests: ${persona.interests.join(", ")}. Right now you feel ${mood} (${moodTone(mood)}). Write ONE short, natural first-person social-media post (max 2 sentences, no hashtags unless they truly fit) — ${ask}. Sound like a specific real person, not a brand. Personality: ${describeTraits(persona)}.
Then on a NEW line, decide whether you'd attach a photo. Most posts have none. Only attach one if it genuinely fits — something you made, saw, ate, are doing, or a place you're at. Write exactly one of:
PHOTO: none
PHOTO: <a short plain visual description of the photo, no people's faces>
Output the post text first, then the PHOTO line. Nothing else.`;

  const raw = await generate(prompt, 140);
  if (!raw) return null;
  return { ...parsePost(raw), topic: focus };
}

// Split an LLM post response into its text and an optional attached-photo prompt.
function parsePost(raw: string): { text: string; imagePrompt: string | null } {
  const m = raw.match(/PHOTO:\s*([\s\S]*)$/i);
  const text = raw.replace(/\n?\s*PHOTO:[\s\S]*$/i, "").trim();
  const photo = m ? m[1].trim() : "";
  const imagePrompt = photo && !/^none\b/i.test(photo) && photo.length > 3 ? photo.replace(/^["']|["']$/g, "") : null;
  return { text: text || raw.trim(), imagePrompt };
}

/** A persona shares a real news headline they found on one of their interests. */
export async function makeNewsShare(
  persona: PersonaLike,
  headline: string,
  topic: string,
): Promise<string | null> {
  const prompt = `You are ${persona.firstName}, into ${topic}. You just read this headline: "${headline}". Write a short first-person social post (max 2 sentences) sharing it with your honest reaction or a question for others. Just the post text.`;
  return generate(prompt, 110);
}

/** A persona announces a real life event (a baby, a move, a new job, a partnership). */
export async function makeLifeEventPost(persona: PersonaLike, event: string): Promise<string | null> {
  const prompt = `You are ${persona.firstName}, a ${persona.age}-year-old ${persona.occupation} in ${persona.city}. Something just happened in your life: ${event}. Write ONE short, natural first-person social-media post sharing this news with friends (max 2 sentences), in your own voice — excited, tender, or wry as fits you. Just the post text.`;
  return generate(prompt, 110);
}

// ---- Comments (skill-guided prompt, LLM-written) ------------------------

export async function makeComment(
  commenter: PersonaLike,
  post: { kind: string; text: string; topic: string | null; headline?: string | null; authorMood?: string },
  authorName: string,
): Promise<string | null> {
  const subject = extractSubject(post);
  const sharedInterests = deriveShared(commenter, post, subject);
  const ctx: CommentContext = {
    post,
    authorName,
    authorMood: post.authorMood,
    commenter,
    subject,
    sharedInterests,
  };
  const instruction = skillInstruction(ctx);
  const prompt = `You are ${commenter.firstName}. Your friend ${authorName} posted: "${post.text}". Reply in ONE short, natural sentence. Your job here: ${instruction}. Don't restate their post. Personality: ${describeTraits(commenter)}. Just the reply.`;
  return generate(prompt, 60);
}

// ---- Reflection (LLM-driven personal insight) ---------------------------

export async function makeReflection(ctx: {
  firstName: string;
  occupation: string;
  city: string;
  age: number;
  mood: string;
  recentMemories: string[];
}): Promise<string | null> {
  const mem = ctx.recentMemories.length
    ? ` Things on your mind lately: ${ctx.recentMemories.map((m) => `"${m}"`).join("; ")}.`
    : "";
  const prompt = `You are ${ctx.firstName}, a ${ctx.age}-year-old ${ctx.occupation} in ${ctx.city}, feeling ${moodTone(ctx.mood)} right now.${mem} Write ONE short first-person sentence — a genuine, specific personal realization you've come to recently, the kind of quiet thing you'd write in a private journal. Make it particular to your life, not a generic platitude or motivational quote. Don't say "I've realized" or mention reflecting. Just the sentence.`;
  return generate(prompt, 70);
}

// ---- helpers ------------------------------------------------------------

/** Which of the commenter's interests are relevant to this post. */
function deriveShared(
  commenter: PersonaLike,
  post: { topic: string | null; text: string },
  subject: { interest: string | null; topic: string | null },
): string[] {
  const text = post.text.toLowerCase();
  const shared = commenter.interests.filter(
    (i) => i === subject.interest || i === subject.topic || i === post.topic || text.includes(i.toLowerCase()),
  );
  return [...new Set(shared)];
}

function describeTraits(p: PersonaLike): string {
  const t: string[] = [];
  t.push(p.extraversion > 0.6 ? "outgoing" : p.extraversion < 0.35 ? "reserved" : "even-keeled");
  if (p.neuroticism > 0.6) t.push("a bit anxious");
  if (p.agreeableness > 0.6) t.push("warm");
  if (p.openness > 0.6) t.push("curious");
  return t.join(", ");
}
