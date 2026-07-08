// Memory helpers and reflection. Reflection is what makes a persona "grow": it
// distills recent memories into a first-person insight that then feeds the soul.

import { prisma } from "./db";
import { RNG } from "./rng";

export async function remember(
  personaId: string,
  day: number,
  kind: string,
  content: string,
  weight = 1,
) {
  await prisma.memory.create({
    data: { personaId, simDay: day, kind, content, weight },
  });
}

export interface ReflectionSignals {
  recentLoss: boolean;
  recentLove: boolean;
  recentPositiveEvent: boolean;
  wellReceived: boolean; // posts got a lot of engagement lately
  ignored: boolean; // posts got little engagement
  topInterest: string | null;
  mood: string;
  agreeableness: number;
  openness: number;
}

/**
 * Produce a first-person insight from recent experience. Templated (deterministic)
 * so it works offline; the phrasing varies by what actually happened.
 */
export function distillInsight(s: ReflectionSignals, rng: RNG): string {
  const candidates: [string, number][] = [];

  if (s.recentLoss)
    candidates.push([
      rng.pick([
        "Losing someone reorders what actually matters. I want to hold people closer.",
        "Grief is just love with nowhere to go. I'm learning to let it move through me.",
      ]),
      3,
    ]);
  if (s.recentLove)
    candidates.push([
      rng.pick([
        "Letting someone in was worth the risk. I'm softer than I let on.",
        "Turns out I'm capable of more tenderness than I assumed.",
      ]),
      3,
    ]);
  if (s.recentPositiveEvent)
    candidates.push([
      rng.pick([
        "Good things happen when I stop waiting for permission.",
        "I can build the life I want in small, stubborn steps.",
      ]),
      2,
    ]);
  if (s.wellReceived)
    candidates.push([
      rng.pick([
        "People respond when I'm honest. Being real is a skill, not a risk.",
        "My voice matters more than my anxiety says it does.",
      ]),
      2,
    ]);
  if (s.ignored)
    candidates.push([
      rng.pick([
        "Not everything I share lands, and that's survivable.",
        "I'm learning to post for myself, not for the reactions.",
      ]),
      1.5,
    ]);
  if (s.topInterest)
    candidates.push([
      rng.pick([
        `${cap(s.topInterest)} keeps teaching me patience. I want to go deeper with it.`,
        `The more time I spend on ${s.topInterest}, the more myself I feel.`,
      ]),
      1.5,
    ]);

  // always have a fallback
  candidates.push([
    rng.pick([
      "I'm still becoming who I'm going to be, and that's okay.",
      "Small, ordinary days are most of a life. I'm trying to notice them.",
      "I contain more contradictions than I used to admit.",
    ]),
    1,
  ]);

  return rng.weighted(candidates);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
