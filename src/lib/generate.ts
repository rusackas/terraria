// Procedural persona generation. Everything is derived deterministically from a
// seed, so the same seed always yields the same person.

import { RNG } from "./rng";
import { renderFace } from "./avatar";
import { DAYS_PER_YEAR } from "./time";
import {
  MALE_NAMES, FEMALE_NAMES, NEUTRAL_NAMES, LAST_NAMES,
  REGIONS, OCCUPATIONS, EDUCATION, INTERESTS,
} from "./data";

export interface GeneratedPersona {
  seed: string;
  firstName: string;
  lastName: string;
  gender: string;
  pronouns: string;
  birthDay: number;
  country: string;
  city: string;
  occupation: string;
  education: string;
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  interests: string[];
  bio: string;
  avatarSeed: string;
}

function occupationForAge(rng: RNG, age: number): string {
  if (age < 5) return "toddler";
  if (age < 18) return "student";
  if (age < 23 && rng.chance(0.6)) return "student";
  if (age >= 67 && rng.chance(0.75)) return "retired";
  return rng.weighted(OCCUPATIONS);
}

/**
 * Generate a persona.
 * @param seed unique seed string
 * @param currentDay world clock, used to place a plausible birthDay for a given age
 * @param forcedAge optional target age at currentDay (else drawn from a distribution)
 */
export function generatePersona(
  seed: string,
  currentDay: number,
  forcedAge?: number,
): GeneratedPersona {
  const rng = new RNG(seed);

  // gender
  const gender = rng.weighted([
    ["male", 48],
    ["female", 48],
    ["nonbinary", 4],
  ] as const);
  const pronouns =
    gender === "male" ? "he/him" : gender === "female" ? "she/her" : "they/them";

  // name
  const firstPool =
    gender === "male"
      ? MALE_NAMES
      : gender === "female"
        ? FEMALE_NAMES
        : rng.chance(0.5)
          ? NEUTRAL_NAMES
          : rng.chance(0.5)
            ? MALE_NAMES
            : FEMALE_NAMES;
  const firstName = rng.pick(firstPool);
  const lastName = rng.pick(LAST_NAMES);

  // age -> birthDay. Adult-skewed distribution for the initial population.
  const age =
    forcedAge ??
    rng.weighted([
      [rng.int(0, 12), 12],
      [rng.int(13, 19), 12],
      [rng.int(20, 34), 30],
      [rng.int(35, 54), 28],
      [rng.int(55, 74), 15],
      [rng.int(75, 92), 3],
    ] as const);
  const jitter = rng.int(0, DAYS_PER_YEAR - 1);
  const birthDay = currentDay - age * DAYS_PER_YEAR - jitter;

  // region
  const [country, , cities] = rng.weighted(
    REGIONS.map((r) => [r, r[1]] as const),
  );
  const city = rng.pick(cities);

  // occupation + education
  const occupation = occupationForAge(rng, age);
  const education =
    age < 18 ? "in school" : rng.weighted(EDUCATION);

  // Big Five
  const openness = round2(rng.normal01());
  const conscientiousness = round2(rng.normal01());
  const extraversion = round2(rng.normal01());
  const agreeableness = round2(rng.normal01());
  const neuroticism = round2(rng.normal01());

  // interests: more if higher openness
  const nInterests = 2 + Math.round(openness * 4);
  const interests = rng.sample(INTERESTS, nInterests);

  const bio = writeBio({
    firstName, occupation, city, country, interests, extraversion, openness, age,
  });

  return {
    seed,
    firstName,
    lastName,
    gender,
    pronouns,
    birthDay,
    country,
    city,
    occupation,
    education,
    openness,
    conscientiousness,
    extraversion,
    agreeableness,
    neuroticism,
    interests,
    bio,
    avatarSeed: `${seed}::${rng.int(0, 1e9)}`,
  };
}

function writeBio(p: {
  firstName: string;
  occupation: string;
  city: string;
  country: string;
  interests: string[];
  extraversion: number;
  openness: number;
  age: number;
}): string {
  const ints = p.interests.slice(0, 3).join(", ");
  if (p.age < 13) {
    return `A curious kid from ${p.city}. Loves ${ints}.`;
  }
  const vibe =
    p.extraversion > 0.6
      ? "Always up for meeting new people."
      : p.extraversion < 0.35
        ? "Happier with a small circle and a quiet evening."
        : "Somewhere between homebody and social butterfly.";
  const curious =
    p.openness > 0.6 ? " Perpetually chasing a new rabbit hole." : "";
  const role = ["student", "retired", "toddler"].includes(p.occupation)
    ? p.occupation === "retired"
      ? "Retired and enjoying it"
      : "Student"
    : `${p.occupation[0].toUpperCase()}${p.occupation.slice(1)}`;
  return `${role} in ${p.city}, ${p.country}. Into ${ints}. ${vibe}${curious}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build the avatar SVG for a persona at a given age. */
export function faceFor(
  avatarSeed: string,
  ageYears: number,
  gender: string,
): string {
  return renderFace({ seed: avatarSeed, ageYears, gender });
}
