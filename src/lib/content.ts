// Content generation for posts and comments. Templated by default (always works,
// offline). If an AI Gateway key is configured, LLM output is used instead.
// Posts are conditioned on the persona's heartbeat (mood + current focus); comments
// are produced by the skill system so they respond to the actual post.

import { RNG } from "./rng";
import { TOPICS } from "./data";
import { moodTone } from "./heartbeat";
import { generate, llmAvailable } from "./llm";
import {
  extractSubject,
  generateComment,
  skillInstruction,
  type CommentContext,
} from "./skills";

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

const llmEnabled = llmAvailable;
const llm = generate;

// ---- Post generation ----------------------------------------------------

const STATUS_TEMPLATES = [
  (r: RNG, p: PersonaLike, focus: string) => `Spent the afternoon on ${focus}. Exactly what I needed.`,
  (r: RNG, p: PersonaLike) => `Some days ${p.occupation === "student" ? "studying" : `being a ${p.occupation}`} in ${p.city} is a lot. Today was one of them.`,
  (r: RNG, p: PersonaLike, focus: string) => `Thinking about going deeper on ${focus} lately. Anyone else into it?`,
  (r: RNG, p: PersonaLike) => `${p.city} is doing that thing again where the whole city feels like a movie set. I love it here.`,
  (r: RNG, p: PersonaLike, focus: string) => `${cap(focus)} kind of saved my week, honestly.`,
  (r: RNG, p: PersonaLike, focus: string) => `Hot take: ${focus} is criminally underrated.`,
  (r: RNG) => `Small win today. Won't bore you with details, but it mattered to me.`,
];

const MOOD_OPENERS: Record<string, string[]> = {
  joyful: ["Can't stop smiling today.", "Everything feels a little golden right now."],
  "in love": ["My whole chest is warm lately.", "So this is what people mean."],
  inspired: ["Head full of ideas I can't sit still.", "Feeling weirdly unstoppable."],
  hopeful: ["Quietly optimistic these days.", "Something's shifting, I can feel it."],
  grieving: ["Heavy one today.", "Missing someone more than usual."],
  anxious: ["Brain won't quiet down tonight.", "Trying not to spiral, bear with me."],
  lonely: ["Kind of a quiet stretch lately.", "Anyone else feel far from people this week?"],
  tired: ["Running on fumes.", "This week asked a lot of me."],
  restless: ["Itching for a change I can't name.", "Can't tell if I'm bored or just restless."],
};

export async function makePost(
  seed: string,
  persona: PersonaLike,
  kind: string,
  hb?: Heartbeat,
): Promise<{ text: string; topic: string | null }> {
  const r = new RNG(seed);
  const focus = hb?.focus || (persona.interests.length ? r.pick(persona.interests) : "life");
  const mood = hb?.mood ?? "content";
  const topic = focus || r.pick(TOPICS);

  const prompt = `You are ${persona.firstName}, a ${persona.age}-year-old ${persona.occupation} in ${persona.city}. Interests: ${persona.interests.join(", ")}. Right now you're feeling ${mood} (${moodTone(mood)}) and preoccupied with ${focus}. Write a single short, natural social-media post (max 2 sentences, first person, no hashtags) that reflects that mood and focus. Personality: ${describeTraits(persona)}. Just the post text.`;

  const llmText = await llm(prompt);
  if (llmText) return { text: llmText, topic };

  // Milestones are genuine life wins — keep them upbeat and self-contained.
  if (kind === "milestone") {
    return {
      text: r.pick([
        `Big news — ${r.pick(["new chapter starting", "made a decision I've been sitting on for months", "finally did the thing"])}. More soon.`,
        `Okay, I did it. Been working toward this for a long time and it finally happened.`,
        `Some good news for once: things are genuinely looking up. Grateful.`,
      ]),
      topic,
    };
  }

  // Templated: sometimes lead with a mood opener, then a focus-driven line.
  const opener = MOOD_OPENERS[mood];
  if (opener && r.chance(0.5)) {
    return { text: `${r.pick(opener)} ${r.pick(STATUS_TEMPLATES)(r, persona, focus)}`, topic };
  }
  const pool =
    kind === "opinion"
      ? [
          (rr: RNG) => `I keep coming back to this: ${focus} teaches you more about patience than anything else.`,
          () => `Unpopular opinion, but the old way was better. Fight me (gently).`,
          (rr: RNG) => `Been chewing on ${rr.pick(TOPICS)}. Not sure where I land yet, honestly.`,
        ]
      : STATUS_TEMPLATES;
  const t = pool[Math.floor(r.float() * pool.length)];
  return { text: (t as (r: RNG, p: PersonaLike, f: string) => string)(r, persona, focus), topic };
}

/** A persona shares a real news headline they found on one of their interests. */
export async function makeNewsShare(
  seed: string,
  persona: PersonaLike,
  headline: string,
  topic: string,
): Promise<string> {
  const r = new RNG(seed);
  const prompt = `You are ${persona.firstName}, into ${topic}. You just read this headline: "${headline}". Write a single short social post (max 2 sentences) sharing it with your honest reaction or a question. First person. Just the text.`;
  const llmText = await llm(prompt);
  if (llmText) return llmText;
  return r.pick([
    `Been following ${topic} and this caught my eye: "${headline}". Curious what you all make of it.`,
    `Okay, ${topic} people — thoughts on this? "${headline}"`,
    `This is exactly the kind of ${topic} news I can't stop thinking about: "${headline}".`,
    `Sharing because it matters to me: "${headline}". Anyone else been tracking this?`,
  ]);
}

// ---- Comment generation (skill-driven) ----------------------------------

export async function makeComment(
  seed: string,
  commenter: PersonaLike,
  post: { kind: string; text: string; topic: string | null; headline?: string | null; authorMood?: string },
  authorName: string,
): Promise<{ text: string; skill: string }> {
  const r = new RNG(seed);
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

  if (llmEnabled()) {
    const instruction = skillInstruction(ctx);
    const prompt = `You are ${commenter.firstName}. Your friend ${authorName} posted: "${post.text}". Reply in one short, natural sentence. Your job here: ${instruction}. Personality: ${describeTraits(commenter)}. Just the reply.`;
    const llmText = await llm(prompt, 60);
    if (llmText) return { text: llmText, skill: "llm" };
  }

  return generateComment(ctx, r);
}

/** Which of the commenter's interests are relevant to this post. */
function deriveShared(
  commenter: PersonaLike,
  post: { topic: string | null; text: string },
  subject: { interest: string | null; isNews: boolean; topic: string | null },
): string[] {
  const text = post.text.toLowerCase();
  const shared = commenter.interests.filter(
    (i) =>
      i === subject.interest ||
      i === subject.topic ||
      i === post.topic ||
      text.includes(i.toLowerCase()),
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

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
