// The "heartbeat" — a persona's moment-to-moment inner state. Each tick nudges
// mood, focus, and energy based on recent experience, and this state then shapes
// what (and whether) they post.

import { RNG } from "./rng";

export interface HeartbeatState {
  mood: string;
  focus: string;
  energy: number;
}

// mood -> valence, roughly -1..1
export const MOODS: Record<string, number> = {
  grieving: -0.9,
  anxious: -0.6,
  lonely: -0.5,
  restless: -0.2,
  tired: -0.2,
  content: 0.3,
  curious: 0.4,
  hopeful: 0.5,
  inspired: 0.7,
  joyful: 0.9,
  "in love": 0.95,
};

const POSITIVE = ["content", "curious", "hopeful", "inspired", "joyful"];
const NEGATIVE = ["restless", "tired", "lonely", "anxious"];

export interface HeartbeatSignals {
  reactionsReceived: number; // positive attention since last beat
  commentsReceived: number;
  hadPositiveEvent: boolean; // job, milestone, child
  hadLoss: boolean; // a close relation died
  becamePartner: boolean;
  neuroticism: number;
  extraversion: number;
  openness: number;
  interests: string[];
}

/**
 * Advance a heartbeat. Deterministic given rng, previous state, and signals.
 */
export function beat(
  rng: RNG,
  prev: HeartbeatState,
  s: HeartbeatSignals,
): HeartbeatState {
  // Strong events override drift.
  let mood = prev.mood;
  if (s.hadLoss) mood = "grieving";
  else if (s.becamePartner) mood = "in love";
  else if (s.hadPositiveEvent) mood = rng.pick(["joyful", "hopeful", "inspired"]);
  else {
    // Attention lifts mood; silence + neuroticism drags it.
    const attention = s.reactionsReceived + s.commentsReceived * 2;
    let drift = attention * 0.15 - 0.1 - s.neuroticism * 0.15;
    // extraverts crave interaction; a quiet tick hits them harder
    if (s.extraversion > 0.6 && attention === 0) drift -= 0.15;
    drift += rng.range(-0.25, 0.25); // noise

    const curVal = MOODS[prev.mood] ?? 0.3;
    const target = curVal + drift;
    mood = nearestMood(target, rng);
  }

  // Focus: usually one of their interests; sometimes drawn to a fresh one.
  let focus = prev.focus;
  const shiftFocus = !focus || rng.chance(0.35 + s.openness * 0.3);
  if (shiftFocus && s.interests.length) {
    focus = rng.pick(s.interests);
  }

  // Energy random-walks, boosted by good mood.
  const val = MOODS[mood] ?? 0.3;
  let energy = prev.energy + rng.range(-0.2, 0.2) + val * 0.1;
  energy = Math.max(0.05, Math.min(1, energy));

  return { mood, focus, energy };
}

function nearestMood(target: number, rng: RNG): string {
  // pick among moods near the target valence, weighted by closeness
  const entries = Object.entries(MOODS);
  const weighted = entries.map(
    ([m, v]) => [m, 1 / (0.1 + Math.abs(v - target))] as const,
  );
  return rng.weighted(weighted);
}

export function moodTone(mood: string): string {
  const v = MOODS[mood] ?? 0.3;
  if (v <= -0.5) return "heavy and vulnerable";
  if (v < 0.2) return "flat, a little worn";
  if (v < 0.6) return "steady, quietly warm";
  return "bright and energized";
}
