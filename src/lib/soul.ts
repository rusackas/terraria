// The "soul" — an evolving markdown identity for each persona. Generated at birth
// from traits and interests, rewritten over time as the persona reflects and grows.

import { simDate } from "./time";

export interface SoulInput {
  firstName: string;
  lastName: string;
  pronouns: string;
  age: number;
  occupation: string;
  city: string;
  country: string;
  interests: string[];
  traits: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  };
  bio: string;
  /** distilled insights from reflection, newest first */
  insights?: string[];
  day: number;
}

function values(t: SoulInput["traits"]): string[] {
  const scored: [string, number][] = [
    ["kindness and loyalty to the people close to me", t.agreeableness],
    ["discipline and following through on what I start", t.conscientiousness],
    ["curiosity and chasing new experiences", t.openness],
    ["connection, community, and not doing life alone", t.extraversion],
    ["a calm, steady inner life over drama", 1 - t.neuroticism],
    ["honesty, even when it's uncomfortable", (t.conscientiousness + t.agreeableness) / 2],
  ];
  return scored
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([v]) => v);
}

function voice(t: SoulInput["traits"]): string {
  const parts: string[] = [];
  parts.push(
    t.extraversion > 0.6
      ? "I'm warm and talkative — I overshare a little and I'm okay with that."
      : t.extraversion < 0.35
        ? "I keep my words few. If I say something, I mean it."
        : "I can be chatty or quiet depending on the room.",
  );
  if (t.openness > 0.6) parts.push("I think in tangents and metaphors and love a good rabbit hole.");
  if (t.neuroticism > 0.6) parts.push("I second-guess myself and feelings hit me hard.");
  if (t.agreeableness > 0.6) parts.push("I default to encouragement before critique.");
  if (t.conscientiousness > 0.6) parts.push("I like things concrete, with a next step.");
  return parts.join(" ");
}

function chapter(a: number, occupation: string, city: string): string {
  if (a < 13) return `Still a kid, figuring out the world from ${city}.`;
  if (a < 20) return `A teenager — everything feels enormous right now.`;
  if (a < 30) return `Early adulthood: building a life, mostly making it up as I go.`;
  if (a < 45) return `Deep in the busy middle — ${occupation} by day, and a lot else besides.`;
  if (a < 65) return `Settled into who I am. Less to prove, more to enjoy.`;
  return `Later chapters now. I think a lot about what mattered.`;
}

export function buildSoul(input: SoulInput): string {
  const { firstName, lastName, pronouns, age, occupation, city, country, interests, bio } = input;
  const vals = values(input.traits);
  const lines: string[] = [];

  lines.push(`# ${firstName} ${lastName}`);
  lines.push("");
  lines.push(`*${age}, ${pronouns} · ${occupation} in ${city}, ${country}*`);
  lines.push("");
  lines.push(`## Who I am`);
  lines.push(bio);
  lines.push("");
  lines.push(`## What I value`);
  for (const v of vals) lines.push(`- ${v}`);
  lines.push("");
  lines.push(`## What I love`);
  lines.push(interests.length ? interests.join(", ") + "." : "Still figuring that out.");
  lines.push("");
  lines.push(`## My voice`);
  lines.push(voice(input.traits));
  lines.push("");
  lines.push(`## Where I am right now`);
  lines.push(chapter(age, occupation, city));

  if (input.insights && input.insights.length) {
    lines.push("");
    lines.push(`## What I've learned`);
    for (const i of input.insights.slice(0, 6)) lines.push(`- ${i}`);
  }

  lines.push("");
  lines.push(`---`);
  lines.push(`*Soul last updated ${simDate(input.day)}.*`);
  return lines.join("\n");
}
