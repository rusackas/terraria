// Comment "skills": composable behaviors a persona can apply to a thread. Each
// skill scores how well it fits a given post + commenter, and the best-fitting one
// generates a reply that references the post's actual subject. This replaces the
// old generic-template comments.

import { RNG } from "./rng";
import { INTERESTS } from "./data";
import { MOODS } from "./heartbeat";
import type { PersonaLike } from "./content";

export interface PostSubject {
  interest: string | null; // an interest detected in the post
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
  authorMood?: string; // the poster's current mood, if known
  commenter: PersonaLike; // includes firstName, interests, traits
  subject: PostSubject;
  sharedInterests: string[]; // commenter's interests relevant to the post
}

function moodValence(mood?: string): number {
  return mood ? (MOODS[mood] ?? 0) : 0;
}

const WIN_RE = /\b(win|finally|proud|got the|landed|nailed|milestone|new chapter|good news|excited|celebrat)/i;
const STRUGGLE_RE = /\b(hard|tough|a lot|exhausted|frustrat|struggl|miss|tired|rough|overwhelm|anxious|lonely|lost)/i;

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

// A pinch of topic-specific flavor so "relate" reads as genuinely on-topic.
const INTEREST_TALK: Record<string, string[]> = {
  woodworking: ["What are you building?", "Hand tools or power tools person?", "I just finished a walnut shelf — obsessed."],
  hiking: ["Which trail?", "I need to get back out there. Any favorites lately?", "Boots or trail runners?"],
  cooking: ["Okay now I need the recipe.", "What are you making?", "I've been on a braising kick myself."],
  "indie music": ["Who are you listening to right now?", "Drop the playlist!", "Have you heard the new stuff coming out of the scene?"],
  photography: ["Film or digital?", "What are you shooting these days?", "Golden hour or bust, honestly."],
  gardening: ["What's coming up this season?", "My tomatoes are thriving, ask me anything.", "Raised beds changed my life."],
  "video games": ["What are you playing?", "Co-op or solo?", "My backlog is out of control too."],
  climbing: ["Indoor or outdoor?", "What grade are you projecting?", "My forearms hurt just reading this."],
  cycling: ["Road or gravel?", "How many miles this week?", "Envious — I've been off the bike too long."],
  painting: ["What medium?", "Would love to see it when it's done.", "I keep meaning to pick a brush back up."],
  astronomy: ["Seen anything good lately?", "Telescope or naked eye?", "The sky's been unreal this month."],
  coffee: ["Pour over or espresso?", "What beans?", "I'm insufferable about this too, welcome."],
  "board games": ["What's on the table?", "Heavy euro or party game?", "Bring it to game night!"],
  chess: ["What's your opening these days?", "Online or over the board?", "I'm stuck around my rating too."],
  running: ["What's the distance?", "Training for anything?", "The early miles are the hardest, you've got this rhythm though."],
  jazz: ["Who are you spinning?", "Records or streaming?", "Nothing beats a rainy day and a good record."],
  pottery: ["Wheel or hand-building?", "Show me the glaze when it's fired!", "I love that it forces you to slow down."],
  baking: ["What are you baking?", "Sourdough starter still alive?", "The smell alone is worth it."],
  "tabletop RPGs": ["What system?", "Playing or running it?", "My group just wrapped a two-year campaign, gutted."],
  travel: ["Where to?", "Solo or with people?", "Adding it to my list right now."],
};

function interestTalk(interest: string, rng: RNG): string {
  const lines = INTEREST_TALK[interest];
  if (lines) return rng.pick(lines);
  return rng.pick([
    `How long have you been into ${interest}?`,
    `${cap(interest)} is such an underrated way to spend time.`,
    `What got you into ${interest}?`,
    `Fellow ${interest} person here — love to see it.`,
  ]);
}

interface Skill {
  name: string;
  score(ctx: CommentContext, rng: RNG): number;
  gen(ctx: CommentContext, rng: RNG): string;
}

const SKILLS: Skill[] = [
  {
    name: "celebrate",
    score: (c) =>
      (c.subject.isWin ? 0.9 : 0) +
      (moodValence(c.authorMood) > 0.6 ? 0.5 : 0) -
      (moodValence(c.authorMood) < -0.2 ? 0.8 : 0), // don't cheer a down mood
    gen: (c, r) =>
      r.pick([
        `Huge — congrats, ${c.authorName}! You earned this.`,
        `Let's go! So happy for you.`,
        `This is wonderful news. Tell us more when you're ready.`,
        `Been rooting for you — this made my day.`,
        `Yes! Love seeing good things happen to good people.`,
      ]),
  },
  {
    name: "empathize",
    score: (c) =>
      (c.subject.isStruggle && !c.subject.isWin ? 0.85 : 0) +
      (moodValence(c.authorMood) <= -0.4 ? 0.7 : 0),
    gen: (c, r) =>
      r.pick([
        `Ugh, those days are the worst. Go easy on yourself tonight.`,
        `Sending you a lot of warmth. Here if you want to vent.`,
        `That sounds genuinely hard. You're allowed to feel this.`,
        `Rooting for you through this one. It won't feel like this forever.`,
        `Hey — glad you said it out loud. I'm around if you need to talk.`,
      ]),
  },
  {
    name: "discussNews",
    score: (c) => (c.subject.isNews ? 0.95 : 0),
    gen: (c, r) => {
      const t = c.subject.topic ?? c.subject.interest ?? "this";
      const shared = c.sharedInterests.length > 0;
      const pool = shared
        ? [
            `Oh this is right up my alley — I've been following ${t} closely. Where do you land on it?`,
            `Saw this too. Honestly not sure the ${t} coverage is getting it right. Thoughts?`,
            `Big if true. This changes how I think about ${t}.`,
            `Finally someone else who cares about ${t} news. What's your read?`,
          ]
        : [
            `Huh, hadn't seen this. What's the ${t} angle here?`,
            `Interesting share — is this a big deal for ${t} or more of a blip?`,
            `Not my usual beat but this caught my eye. Thanks for posting.`,
          ];
      return r.pick(pool);
    },
  },
  {
    name: "relate",
    score: (c) => (c.sharedInterests.length && !c.subject.isNews ? 0.7 : 0),
    gen: (c, r) => interestTalk(r.pick(c.sharedInterests), r),
  },
  {
    name: "agree",
    score: (c) =>
      c.post.kind === "opinion" && c.commenter.agreeableness > 0.5 ? 0.55 : 0,
    gen: (c, r) =>
      r.pick([
        `Yes — you put words to something I've felt for a while.`,
        `Completely with you on this.`,
        `Hard agree. More people need to hear it.`,
      ]),
  },
  {
    name: "softDisagree",
    score: (c) =>
      c.post.kind === "opinion" && c.commenter.agreeableness < 0.4 ? 0.6 : 0,
    gen: (c, r) =>
      r.pick([
        `I see it differently, honestly — but you make me want to think it through.`,
        `Respectfully not sure I'm there with you. What changed your mind?`,
        `Hmm. Half agree. The other half I'd push back on.`,
      ]),
  },
  {
    name: "curious",
    score: (c) =>
      (c.subject.isQuestion ? 0.5 : 0) +
      (c.subject.interest ? 0.45 : 0) +
      (c.commenter.openness > 0.6 ? 0.2 : 0),
    gen: (c, r) =>
      c.subject.interest
        ? interestTalk(c.subject.interest, r)
        : r.pick([`Ooh, say more?`, `Wait, I'm curious — what do you mean exactly?`, `Tell me everything.`]),
  },
  {
    name: "banter",
    // low-priority fallback; only wins when nothing more specific applies
    score: (c) => (c.commenter.extraversion > 0.55 ? 0.18 : 0.06),
    gen: (c, r) => {
      const subj = c.subject.interest || c.subject.topic;
      if (subj && r.chance(0.6)) {
        return r.pick([
          `${cap(subj)}, nice. Respect.`,
          `Okay, ${subj} — you have my attention.`,
          `See, this is why I keep you on my feed.`,
          `${cap(subj)} enjoyer, I see you.`,
        ]);
      }
      return r.pick([
        `Ha, this is so you.`,
        `Living the dream over there, I see.`,
        `Love this energy.`,
        `Okay but same, honestly.`,
        `This showed up right when I needed it.`,
      ]);
    },
  },
];

/** Choose the best-fitting skill and generate a reply. */
export function generateComment(ctx: CommentContext, rng: RNG): { text: string; skill: string } {
  let best: Skill | null = null;
  let bestScore = 0;
  for (const s of SKILLS) {
    const score = s.score(ctx, rng) + rng.range(0, 0.08);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  const skill = best ?? SKILLS[SKILLS.length - 1];
  return { text: skill.gen(ctx, rng), skill: skill.name };
}

/** For the LLM path: describe the chosen skill as an instruction. */
export function skillInstruction(ctx: CommentContext): string {
  let best = "react naturally";
  let bestScore = 0;
  const rng = new RNG("instr"); // deterministic, no noise needed here
  for (const s of SKILLS) {
    const score = s.score(ctx, rng);
    if (score > bestScore) {
      bestScore = score;
      best = s.name;
    }
  }
  const map: Record<string, string> = {
    celebrate: "warmly congratulate them",
    empathize: "offer genuine, specific emotional support",
    discussNews: "engage with the news substantively — give a real take or ask a pointed question",
    relate: `connect over your shared interest (${ctx.sharedInterests.join(", ")}) with a specific detail or question`,
    agree: "agree and build on their point",
    softDisagree: "respectfully push back and explain why",
    curious: "ask a genuine, specific follow-up question",
    banter: "reply with light, friendly banter",
  };
  return map[best] ?? "react naturally";
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
