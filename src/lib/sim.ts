// The clock. Each tick() advances the world, ages everyone, generates activity,
// grows the social graph, and rolls life events (including births and deaths).

import { prisma } from "./db";
import { RNG } from "./rng";
import { ageOf, DAYS_PER_YEAR, simDate } from "./time";
import { generatePersona, faceFor } from "./generate";
import { makePost, makeComment, type PersonaLike } from "./content";
import { REACTION_TYPES } from "./data";
import type { Persona } from "@prisma/client";

const AVATAR_REFRESH_YEARS = 5;

export interface TickReport {
  tick: number;
  day: number;
  date: string;
  population: number;
  posts: number;
  comments: number;
  reactions: number;
  newRelationships: number;
  births: number;
  deaths: number;
  events: string[];
}

function interestsOf(p: Persona): string[] {
  try {
    return JSON.parse(p.interests) as string[];
  } catch {
    return [];
  }
}

function toPersonaLike(p: Persona, day: number): PersonaLike {
  return {
    firstName: p.firstName,
    occupation: p.occupation,
    city: p.city,
    interests: interestsOf(p),
    extraversion: p.extraversion,
    neuroticism: p.neuroticism,
    openness: p.openness,
    agreeableness: p.agreeableness,
    age: ageOf(p.birthDay, day),
  };
}

function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Advance the world by one tick. */
export async function tick(): Promise<TickReport> {
  const world = await prisma.world.upsert({
    where: { id: "world" },
    create: { id: "world" },
    update: {},
  });

  const day = world.currentDay + world.daysPerTick;
  const tickNo = world.tickCount + 1;
  const rng = new RNG(`${world.seed}::tick::${tickNo}`);

  const events: string[] = [];
  let posts = 0, comments = 0, reactions = 0, newRelationships = 0, births = 0, deaths = 0;

  const alive = await prisma.persona.findMany({ where: { alive: true } });
  const byId = new Map(alive.map((p) => [p.id, p]));

  // 1) AGING: refresh avatars whose portrait is ~AVATAR_REFRESH_YEARS stale.
  for (const p of alive) {
    const age = ageOf(p.birthDay, day);
    const current = await prisma.avatar.findFirst({
      where: { personaId: p.id, current: true },
      orderBy: { simDay: "desc" },
    });
    if (!current || age - current.ageYears >= AVATAR_REFRESH_YEARS) {
      await prisma.avatar.updateMany({
        where: { personaId: p.id, current: true },
        data: { current: false },
      });
      await prisma.avatar.create({
        data: {
          personaId: p.id,
          simDay: day,
          ageYears: age,
          svg: faceFor(p.avatarSeed, age, p.gender),
          current: true,
        },
      });
    }
  }

  // 2) POSTING: chance scales with extraversion.
  const newPosts: { id: string; authorId: string; text: string; topic: string | null }[] = [];
  for (const p of alive) {
    const age = ageOf(p.birthDay, day);
    if (age < 8) continue; // little ones don't post
    const pPost = 0.15 + p.extraversion * 0.45;
    if (!rng.chance(pPost)) continue;

    const kind = rng.weighted([
      ["status", 60],
      ["opinion", 25],
      ["milestone", 15],
    ] as const);
    const { text, topic } = await makePost(
      `${world.seed}:post:${p.id}:${tickNo}`,
      toPersonaLike(p, day),
      kind,
    );
    const post = await prisma.post.create({
      data: { authorId: p.id, simDay: day, kind, topic, text },
    });
    newPosts.push({ id: post.id, authorId: p.id, text, topic });
    posts++;
  }

  // 3) FEED SCANNING: personas react/comment on recent posts by affinity.
  // Consider posts from this tick plus the previous window.
  const recentPosts = await prisma.post.findMany({
    where: { simDay: { gte: day - world.daysPerTick } },
    orderBy: { simDay: "desc" },
    take: 200,
  });

  // Pre-load existing reactions so we never attempt a duplicate.
  const reacted = new Set<string>();
  if (recentPosts.length) {
    const existing = await prisma.reaction.findMany({
      where: { postId: { in: recentPosts.map((p) => p.id) } },
      select: { postId: true, personaId: true },
    });
    for (const e of existing) reacted.add(`${e.postId}:${e.personaId}`);
  }

  // Precompute the social graph in memory (one query, then no per-post lookups).
  const allRels = await prisma.relationship.findMany({
    select: { aId: true, bId: true, strength: true },
  });
  const strengthMap = new Map<string, number>(); // "a|b" (a<b) -> strength
  const neighbors = new Map<string, string[]>(); // personaId -> connected ids
  for (const r of allRels) {
    const [x, y] = pairKey(r.aId, r.bId);
    strengthMap.set(`${x}|${y}`, r.strength);
    (neighbors.get(r.aId) ?? neighbors.set(r.aId, []).get(r.aId)!).push(r.bId);
    (neighbors.get(r.bId) ?? neighbors.set(r.bId, []).get(r.bId)!).push(r.aId);
  }

  const relTouch = new Map<string, number>(); // pairKey -> interaction weight

  for (const post of recentPosts) {
    const author = byId.get(post.authorId);
    if (!author) continue;
    const authorInterests = new Set(interestsOf(author));

    // Feed = the author's existing network (who'd see their post) + discovery.
    const net = (neighbors.get(post.authorId) ?? [])
      .map((id) => byId.get(id))
      .filter((p): p is Persona => !!p);
    const friends = rng.sample(net, Math.min(net.length, 8));
    const discovery = rng.sample(alive, 5);
    const seen = new Set<string>();
    const audience: Persona[] = [];
    for (const v of [...friends, ...discovery]) {
      if (v.id === post.authorId || seen.has(v.id)) continue;
      seen.add(v.id);
      audience.push(v);
    }

    for (const viewer of audience) {
      if (ageOf(viewer.birthDay, day) < 10) continue;

      const [px, py] = pairKey(viewer.id, post.authorId);
      const rel = strengthMap.get(`${px}|${py}`) ?? 0;
      const shared = interestsOf(viewer).filter((i) => authorInterests.has(i)).length;
      const affinity =
        shared * 0.16 + rel * 0.55 + viewer.agreeableness * 0.12 + viewer.extraversion * 0.08;

      // react
      const rkey = `${post.id}:${viewer.id}`;
      if (!reacted.has(rkey) && rng.chance(Math.min(0.6, 0.06 + affinity))) {
        await prisma.reaction.create({
          data: {
            postId: post.id,
            personaId: viewer.id,
            type: rng.weighted(
              REACTION_TYPES.map((t) => [t, t === "like" || t === "love" ? 4 : 1] as const),
            ),
            simDay: day,
          },
        });
        reacted.add(rkey);
        reactions++;
        bump(relTouch, viewer.id, post.authorId, 0.05 + shared * 0.015);
      }

      // comment (rarer)
      if (rng.chance(Math.min(0.22, 0.015 + affinity * 0.4))) {
        const text = await makeComment(
          `${world.seed}:cmt:${post.id}:${viewer.id}`,
          toPersonaLike(viewer, day),
          post.text,
          author.firstName,
        );
        await prisma.comment.create({
          data: { postId: post.id, authorId: viewer.id, text, simDay: day },
        });
        comments++;
        bump(relTouch, viewer.id, post.authorId, 0.1 + shared * 0.02);
      }
    }
  }

  // 4) RELATIONSHIPS: apply accumulated interaction weight.
  for (const [key, weight] of relTouch) {
    const [aId, bId] = key.split("|");
    const existing = await prisma.relationship.findUnique({
      where: { aId_bId: { aId, bId } },
    });
    if (existing) {
      const strength = Math.min(1, existing.strength + weight);
      await prisma.relationship.update({
        where: { id: existing.id },
        data: { strength, type: relType(strength, existing.type) },
      });
    } else if (weight > 0.04) {
      await prisma.relationship.create({
        data: { aId, bId, strength: weight, type: "acquaintance", sinceDay: day },
      });
      newRelationships++;
    }
  }

  // 5) LIFE EVENTS: jobs, moves, partnerships, children, illness, death.
  const yearsPerTick = world.daysPerTick / DAYS_PER_YEAR;
  for (const p of alive) {
    const age = ageOf(p.birthDay, day);

    // Death (age-based mortality).
    const annualMortality = Math.min(0.5, 0.0002 * Math.exp(0.085 * age));
    const tickMortality = 1 - Math.pow(1 - annualMortality, yearsPerTick);
    if (rng.chance(tickMortality)) {
      await killPersona(p, day);
      deaths++;
      events.push(`💀 ${p.firstName} ${p.lastName} passed away at ${age}.`);
      continue;
    }

    // Job change.
    if (age >= 18 && age < 67 && rng.chance(0.05 * yearsPerTick + 0.02)) {
      await recordEvent(p, day, "job", `${p.firstName} started a new job.`);
    }

    // Move city.
    if (age >= 18 && rng.chance(0.02)) {
      await recordEvent(p, day, "move", `${p.firstName} moved to a new city.`);
    }

    // Partnership + children handled below.
  }

  // 6) PAIRING & BIRTHS: strong relationships can become partnerships; partners
  //    of childbearing age may have a child (a brand-new persona).
  const strongRels = await prisma.relationship.findMany({
    where: { strength: { gte: 0.6 } },
    orderBy: { strength: "desc" },
  });
  // Who is already partnered? Enforce monogamy across the whole tick.
  const partnered = await partneredSet();
  let babyCounter = 0;
  for (const rel of strongRels) {
    const a = byId.get(rel.aId);
    const b = byId.get(rel.bId);
    if (!a || !b) continue;
    const ageA = ageOf(a.birthDay, day);
    const ageB = ageOf(b.birthDay, day);
    if (ageA < 20 || ageB < 20) continue;

    // become partners — only close friends, only if both are single
    const bothSingle = !partnered.has(a.id) && !partnered.has(b.id);
    if (rel.type !== "partner" && rel.type !== "spouse") {
      if (bothSingle && rel.strength >= 0.65 && rng.chance(0.25)) {
        await prisma.relationship.update({
          where: { id: rel.id },
          data: { type: "partner", strength: Math.min(1, rel.strength + 0.1) },
        });
        partnered.add(a.id);
        partnered.add(b.id);
        events.push(`💞 ${a.firstName} and ${b.firstName} are now partners.`);
        await recordEvent(a, day, "relationship", `${a.firstName} partnered with ${b.firstName}.`);
      }
      continue;
    }

    // have a child
    const fertile = ageA <= 45 && ageB <= 45;
    if ((rel.type === "partner" || rel.type === "spouse") && fertile && rng.chance(0.12 * yearsPerTick + 0.02)) {
      const childSeed = `${world.seed}:child:${rel.id}:${tickNo}:${babyCounter++}`;
      const gen = generatePersona(childSeed, day, 0);
      // inherit a surname + place from a parent
      gen.lastName = rng.chance(0.5) ? a.lastName : b.lastName;
      gen.country = a.country;
      gen.city = a.city;
      const child = await createPersona(gen, day);
      // family links to both parents
      await linkFamily(child.id, a.id, day);
      await linkFamily(child.id, b.id, day);
      births++;
      events.push(`👶 ${a.firstName} & ${b.firstName} welcomed ${child.firstName}.`);
      await recordEvent(a, day, "child", `${a.firstName} became a parent to ${child.firstName}.`);
    }
  }

  // 7) commit the clock.
  await prisma.world.update({
    where: { id: "world" },
    data: { currentDay: day, tickCount: tickNo },
  });

  const population = await prisma.persona.count({ where: { alive: true } });

  return {
    tick: tickNo,
    day,
    date: simDate(day),
    population,
    posts,
    comments,
    reactions,
    newRelationships,
    births,
    deaths,
    events: events.slice(0, 40),
  };
}

// ---- helpers ------------------------------------------------------------

function bump(map: Map<string, number>, a: string, b: string, w: number) {
  const [x, y] = pairKey(a, b);
  const key = `${x}|${y}`;
  map.set(key, (map.get(key) ?? 0) + w);
}

async function partneredSet(): Promise<Set<string>> {
  const rels = await prisma.relationship.findMany({
    where: { type: { in: ["partner", "spouse"] } },
    select: { aId: true, bId: true },
  });
  const s = new Set<string>();
  for (const r of rels) {
    s.add(r.aId);
    s.add(r.bId);
  }
  return s;
}

function relType(strength: number, current: string): string {
  if (current === "partner" || current === "spouse" || current === "family") return current;
  if (strength >= 0.6) return "close_friend";
  if (strength >= 0.3) return "friend";
  return "acquaintance";
}

async function recordEvent(p: Persona, day: number, type: string, description: string) {
  await prisma.lifeEvent.create({ data: { personaId: p.id, simDay: day, type, description } });
  await prisma.memory.create({
    data: { personaId: p.id, simDay: day, kind: "event", content: description, weight: 1.2 },
  });
}

async function killPersona(p: Persona, day: number) {
  await prisma.persona.update({
    where: { id: p.id },
    data: { alive: false, deathDay: day },
  });
  await prisma.lifeEvent.create({
    data: { personaId: p.id, simDay: day, type: "death", description: `${p.firstName} passed away.` },
  });
}

async function linkFamily(childId: string, parentId: string, day: number) {
  const [aId, bId] = pairKey(childId, parentId);
  await prisma.relationship.upsert({
    where: { aId_bId: { aId, bId } },
    create: { aId, bId, type: "family", strength: 1, sinceDay: day },
    update: { type: "family", strength: 1 },
  });
}

export async function createPersona(gen: ReturnType<typeof generatePersona>, day: number) {
  const age = ageOf(gen.birthDay, day);
  const persona = await prisma.persona.create({
    data: {
      seed: gen.seed,
      firstName: gen.firstName,
      lastName: gen.lastName,
      gender: gen.gender,
      pronouns: gen.pronouns,
      birthDay: gen.birthDay,
      country: gen.country,
      city: gen.city,
      occupation: gen.occupation,
      education: gen.education,
      openness: gen.openness,
      conscientiousness: gen.conscientiousness,
      extraversion: gen.extraversion,
      agreeableness: gen.agreeableness,
      neuroticism: gen.neuroticism,
      interests: JSON.stringify(gen.interests),
      bio: gen.bio,
      avatarSeed: gen.avatarSeed,
    },
  });
  await prisma.avatar.create({
    data: {
      personaId: persona.id,
      simDay: day,
      ageYears: age,
      svg: faceFor(gen.avatarSeed, age, gen.gender),
      current: true,
    },
  });
  await prisma.lifeEvent.create({
    data: { personaId: persona.id, simDay: gen.birthDay, type: "birth", description: `${gen.firstName} was born.` },
  });
  return persona;
}
