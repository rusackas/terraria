// Procedural, deterministic SVG portraits. Stands in for a face-GAN: no external
// service, offline-safe, and it *ages* — hair grays, lines appear, styles shift.
// Swap this module for an image-gen call later without touching callers.

import { RNG } from "./rng";

const SKIN = [
  "#8d5524", "#a86b3c", "#c68642", "#d9a066", "#e0ac69", "#f1c27d", "#ffdbac", "#5c3a21",
];
const HAIR = [
  "#0b0b0b", "#2c1b0e", "#3b2416", "#6b4226", "#8d6b3f", "#b07a3a", "#d1b280", "#c04a2b",
];
const GRAY = "#c9c9c9";
const WHITE = "#eeeeee";
const BG = [
  "#fde68a", "#a7f3d0", "#bfdbfe", "#fbcfe8", "#ddd6fe", "#fed7aa", "#bbf7d0", "#e9d5ff",
];

export interface FaceParams {
  seed: string;
  ageYears: number;
  gender: string;
}

export function renderFace({ seed, ageYears, gender }: FaceParams): string {
  const rng = new RNG(`${seed}::face`);

  const skin = rng.pick(SKIN);
  const bg = rng.pick(BG);
  const baseHair = rng.pick(HAIR);
  const eyeColor = rng.pick(["#3b2416", "#1b3a5c", "#2c6e49", "#5a3e2b", "#444"]);

  // Aging: graying probability ramps from ~35, near-total by ~70.
  const grayFactor = Math.max(0, Math.min(1, (ageYears - 35) / 35));
  const hair =
    rng.chance(grayFactor * 0.9)
      ? ageYears > 60
        ? WHITE
        : GRAY
      : baseHair;

  const feminineLean = gender === "female" ? 0.7 : gender === "male" ? 0.15 : 0.45;
  const longHair = rng.chance(feminineLean);
  const balding = gender === "male" && ageYears > 45 && rng.chance((ageYears - 45) / 50);

  const glasses = rng.chance(0.28 + Math.max(0, (ageYears - 40) / 120));
  const smile = rng.range(-3, 8);

  // wrinkles appear with age
  const wrinkles = ageYears > 40 && rng.chance((ageYears - 40) / 40);

  const cx = 100;
  const parts: string[] = [];

  parts.push(`<rect width="200" height="200" fill="${bg}"/>`);
  // neck + shoulders
  parts.push(`<rect x="78" y="150" width="44" height="40" rx="14" fill="${skin}"/>`);
  parts.push(`<path d="M50 200 Q100 150 150 200 Z" fill="${rng.pick(["#334155", "#7c3aed", "#059669", "#be123c", "#0891b2", "#b45309"])}"/>`);

  // long hair behind head
  if (longHair && !balding) {
    parts.push(`<path d="M55 95 Q50 175 70 180 L70 100 Z" fill="${hair}"/>`);
    parts.push(`<path d="M145 95 Q150 175 130 180 L130 100 Z" fill="${hair}"/>`);
  }

  // head
  parts.push(`<ellipse cx="${cx}" cy="100" rx="45" ry="52" fill="${skin}"/>`);
  // ears
  parts.push(`<circle cx="55" cy="102" r="9" fill="${skin}"/><circle cx="145" cy="102" r="9" fill="${skin}"/>`);

  // hair on top
  if (!balding) {
    parts.push(`<path d="M55 92 Q60 48 100 48 Q140 48 145 92 Q120 70 100 70 Q80 70 55 92 Z" fill="${hair}"/>`);
  } else {
    // receded hairline / fringe
    parts.push(`<path d="M60 98 Q62 78 80 74 Q70 88 66 100 Z" fill="${hair}"/>`);
    parts.push(`<path d="M140 98 Q138 78 120 74 Q130 88 134 100 Z" fill="${hair}"/>`);
  }

  // eyes
  const eyeY = 100;
  parts.push(`<ellipse cx="82" cy="${eyeY}" rx="6.5" ry="4.5" fill="#fff"/>`);
  parts.push(`<ellipse cx="118" cy="${eyeY}" rx="6.5" ry="4.5" fill="#fff"/>`);
  parts.push(`<circle cx="82" cy="${eyeY}" r="2.6" fill="${eyeColor}"/>`);
  parts.push(`<circle cx="118" cy="${eyeY}" r="2.6" fill="${eyeColor}"/>`);
  // brows
  const browY = eyeY - 10;
  parts.push(`<rect x="74" y="${browY}" width="16" height="2.4" rx="1.2" fill="${hair}"/>`);
  parts.push(`<rect x="110" y="${browY}" width="16" height="2.4" rx="1.2" fill="${hair}"/>`);

  // nose
  parts.push(`<path d="M100 104 L96 118 Q100 121 104 118 Z" fill="rgba(0,0,0,0.12)"/>`);

  // mouth
  parts.push(`<path d="M88 130 Q100 ${130 + smile} 112 130" stroke="#7a2e2e" stroke-width="3" fill="none" stroke-linecap="round"/>`);

  // facial hair
  if (gender === "male" && rng.chance(0.4)) {
    parts.push(`<path d="M74 122 Q100 150 126 122 Q100 138 74 122 Z" fill="${hair}" opacity="0.85"/>`);
  }

  if (wrinkles) {
    parts.push(`<path d="M72 92 q6 -3 12 0" stroke="rgba(0,0,0,0.12)" stroke-width="1.2" fill="none"/>`);
    parts.push(`<path d="M116 92 q6 -3 12 0" stroke="rgba(0,0,0,0.12)" stroke-width="1.2" fill="none"/>`);
    parts.push(`<path d="M92 138 q8 4 16 0" stroke="rgba(0,0,0,0.10)" stroke-width="1" fill="none"/>`);
  }

  if (glasses) {
    parts.push(`<g stroke="#222" stroke-width="2.2" fill="none">
      <rect x="72" y="93" width="20" height="14" rx="4"/>
      <rect x="108" y="93" width="20" height="14" rx="4"/>
      <line x1="92" y1="100" x2="108" y2="100"/>
    </g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200" role="img">${parts.join("")}</svg>`;
}
