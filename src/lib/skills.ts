// Comment "skills" — a persona picks the behavior that best fits a thread
// (celebrate, empathize, relate, discuss-news, ask, agree/disagree, banter). The
// chosen skill becomes an instruction in the LLM prompt so the reply actually
// responds to the post. (The templated text these skills once produced is gone —
// ongoing content is LLM-only; see content.ts.)

import { RNG } from "./rng";
import { INTERESTS } from "./data";
import { MOODS } from "./heartbeat";
import type { PersonaLike } from "./content";

export interface PostSubject {
  interest: string | null;
  isWin: boolean;
  isStruggle: boolean;
  isQuestion: boolean;
  isNews: boolean;
  headline: string | null;
  topic: string | null;
}

export interface CommentContext {
  post: { kind: string; topic: string | null; text: string; headline?: string | null };
  authorName: string;
  authorMood?: string;
  commenter: PersonaLike;
  subject: PostSubject;
  sharedInterests: string[];
}

function moodValence(mood?: string): number {
  return mood ? (MOODS[mood] ?? 0) : 0;
}

const WIN_RE = /\b(win|finally|proud|got the|landed|nailed|milestone|new chapter|good news|excited|celebrat)/i;
const STRUGGLE_RE = /\b(hard|tough|a lot|exhausted|frustrat|struggl|miss|tired|rough|overwhelm|anxious|lonely|lost|spiral)/i;

export function extractSubject(post: {
  kind: string;
  text: string;
  topic: string | null;
  headline?: string | null;
}): PostSubject {
  const text = post.text.toLowerCase();
  const interest = INTERESTS.find((i) => text.includes(i.toLowerCase())) ?? null;
  return {
    interest,
    isWin: post.kind === "milestone" || WIN_RE.test(post.text),
    isStruggle: STRUGGLE_RE.test(post.text),
    isQuestion: post.text.includes("?"),
    isNews: post.kind === "news",
    headline: post.headline ?? null,
    topic: post.topic,
  };
}

interface Skill {
  name: string;
  score(ctx: CommentContext): number;
}

const SKILLS: Skill[] = [
  {
    name: "celebrate",
    score: (c) =>
      (c.subject.isWin ? 0.9 : 0) +
      (moodValence(c.authorMood) > 0.6 ? 0.5 : 0) -
      (moodValence(c.authorMood) < -0.2 ? 0.8 : 0),
  },
  {
    name: "empathize",
    score: (c) =>
      (c.subject.isStruggle && !c.subject.isWin ? 0.85 : 0) +
      (moodValence(c.authorMood) <= -0.4 ? 0.7 : 0),
  },
  { name: "discussNews", score: (c) => (c.subject.isNews ? 0.95 : 0) },
  { name: "relate", score: (c) => (c.sharedInterests.length && !c.subject.isNews ? 0.7 : 0) },
  { name: "agree", score: (c) => (c.post.kind === "opinion" && c.commenter.agreeableness > 0.5 ? 0.55 : 0) },
  { name: "softDisagree", score: (c) => (c.post.kind === "opinion" && c.commenter.agreeableness < 0.4 ? 0.6 : 0) },
  {
    name: "curious",
    score: (c) =>
      (c.subject.isQuestion ? 0.5 : 0) +
      (c.subject.interest ? 0.45 : 0) +
      (c.commenter.openness > 0.6 ? 0.2 : 0),
  },
  { name: "banter", score: (c) => (c.commenter.extraversion > 0.55 ? 0.18 : 0.06) },
];

const INSTRUCTIONS: Record<string, (c: CommentContext) => string> = {
  celebrate: () => "warmly and specifically congratulate them",
  empathize: () => "offer genuine, specific emotional support — no platitudes",
  discussNews: (c) =>
    `engage with the news substantively — give a real take or a pointed question about ${c.subject.topic ?? "it"}`,
  relate: (c) => `connect over your shared interest in ${c.sharedInterests.join(", ")} with a specific detail or question`,
  agree: () => "agree and build on their point with something of your own",
  softDisagree: () => "respectfully push back and say why",
  curious: () => "ask a genuine, specific follow-up question",
  banter: () => "reply with light, friendly, in-joke-y banter",
};

/** Pick the best-fitting skill and describe it as an instruction for the LLM. */
export function skillInstruction(ctx: CommentContext): string {
  let best = SKILLS[SKILLS.length - 1];
  let bestScore = -Infinity;
  const rng = new RNG("instr"); // deterministic tiebreak
  for (const s of SKILLS) {
    const score = s.score(ctx) + rng.range(0, 0.05);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return (INSTRUCTIONS[best.name] ?? (() => "react naturally"))(ctx);
}
