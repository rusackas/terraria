// The clock. Each tick() advances the world, ages everyone, generates activity,
// grows the social graph, and rolls life events (including births and deaths).

import { prisma } from "./db";
import { RNG } from "./rng";
import { ageOf, DAYS_PER_YEAR, simDate } from "./time";
import { generatePersona, faceFor } from "./generate";
import { makePost, makeComment, makeNewsShare, makeReflection, type PersonaLike } from "./content";
import { REACTION_TYPES } from "./data";
import { buildSoul, type SoulInput } from "./soul";
import { beat, type HeartbeatState, type HeartbeatSignals } from "./heartbeat";
import { remember } from "./memory";
import { getNewsForTopic, markShared } from "./news";
import { resetLlmBudget } from "./llm";
import type { Persona } from "@prisma/client";

const AVATAR_REFRESH_YEARS = 5;
const NEWS_POSTS_PER_TICK = 12; // cap network + share volume per tick
const INVITES_PER_TICK = 8; // cap new associates invited per tick

export interface TickReport {
  tick: number;
  day: number;
  date: string;
  population: number;
  posts: number;
  comments: number;
  reactions: number;
  newsShared: number;
  reflections: number;
  newRelationships: number;
  invites: number;
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

  resetLlmBudget(); // fresh per-tick LLM call budget (see TERRARIA_LLM_BUDGET)

  const events: string[] = [];
  let posts = 0, comments = 0, reactions = 0, newRelationships = 0, births = 0, deaths = 0;
  let newsShared = 0, reflections = 0, invites = 0;

  const alive = await prisma.persona.findMany({ where: { alive: true } });
  const byId = new Map(alive.map((p) => [p.id, p]));

  // 0) HEARTBEAT: gather what happened to each persona since last tick, then
  //    advance their inner state (mood / focus / energy). This drives posting.
  const prevPosts = await prisma.post.findMany({
    where: { simDay: { gte: day - world.daysPerTick } },
    select: { id: true, authorId: true },
  });
  const postAuthor = new Map(prevPosts.map((p) => [p.id, p.authorId]));
  const postedPrev = new Set(prevPosts.map((p) => p.authorId));
  const rxByAuthor = new Map<string, number>();
  const cmByAuthor = new Map<string, number>();
  if (prevPosts.length) {
    const ids = prevPosts.map((p) => p.id);
    const rx = await prisma.reaction.groupBy({ by: ["postId"], where: { postId: { in: ids } }, _count: true });
    for (const r of rx) {
      const a = postAuthor.get(r.postId);
      if (a) rxByAuthor.set(a, (rxByAuthor.get(a) ?? 0) + r._count);
    }
    const cm = await prisma.comment.groupBy({ by: ["postId"], where: { postId: { in: ids } }, _count: true });
    for (const c of cm) {
      const a = postAuthor.get(c.postId);
      if (a) cmByAuthor.set(a, (cmByAuthor.get(a) ?? 0) + c._count);
    }
  }
  // life events since last tick, per persona
  const recentEvents = await prisma.lifeEvent.findMany({
    where: { simDay: { gte: day - world.daysPerTick } },
    select: { personaId: true, type: true },
  });
  const evByPersona = new Map<string, Set<string>>();
  for (const e of recentEvents) {
    let s = evByPersona.get(e.personaId);
    if (!s) evByPersona.set(e.personaId, (s = new Set()));
    s.add(e.type);
  }

  for (const p of alive) {
    // Backfill a soul for anyone created before agents existed.
    if (!p.soul) {
      const soul = buildSoul(soulInputFor(p, day, []));
      await prisma.persona.update({ where: { id: p.id }, data: { soul, soulDay: day } });
      p.soul = soul;
      p.soulDay = day;
    }

    const ev = evByPersona.get(p.id) ?? new Set<string>();
    const signals: HeartbeatSignals = {
      reactionsReceived: rxByAuthor.get(p.id) ?? 0,
      commentsReceived: cmByAuthor.get(p.id) ?? 0,
      hadPositiveEvent: ev.has("job") || ev.has("child") || ev.has("milestone"),
      hadLoss: ev.has("loss"),
      becamePartner: ev.has("relationship"),
      neuroticism: p.neuroticism,
      extraversion: p.extraversion,
      openness: p.openness,
      interests: interestsOf(p),
    };
    const hbRng = new RNG(`${world.seed}:hb:${p.id}:${tickNo}`);
    const prev: HeartbeatState = { mood: p.mood, focus: p.focus, energy: p.energy };
    const next = beat(hbRng, prev, signals);
    await prisma.persona.update({
      where: { id: p.id },
      data: { mood: next.mood, focus: next.focus, energy: next.energy, heartbeatDay: day },
    });
    // mutate in-memory so this tick's posting sees the fresh state
    p.mood = next.mood;
    p.focus = next.focus;
    p.energy = next.energy;
  }

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

  // 2) POSTING: driven by heartbeat (mood, focus, energy). Some posts are shares
  //    of real news the persona "found" on a topic they care about. Done in three
  //    phases so the (slow) LLM calls run in parallel while RNG + DB stay ordered:
  //    (1) sequential: draw all decisions + fetch/pick news;
  //    (2) parallel:   generate post text via the LLM (bounded concurrency);
  //    (3) sequential: persist posts + memories (SQLite is single-writer).
  interface PostTask {
    p: Persona;
    like: PersonaLike;
    kind: string;
    mood: string;
    focus: string;
    rememberIt: boolean;
    news: { topic: string; id: string; title: string; url: string; source: string | null } | null;
  }
  const postTasks: PostTask[] = [];
  let newsPlanned = 0; // caps news fetches/shares this tick (actual count is newsShared)
  for (const p of alive) {
    const age = ageOf(p.birthDay, day);
    if (age < 8) continue; // little ones don't post
    const like = toPersonaLike(p, day);
    const pPost = 0.12 + p.extraversion * 0.4 + p.energy * 0.15;
    if (!rng.chance(pPost)) continue;

    // News share?
    const topicChoice = p.focus || (like.interests.length ? rng.pick(like.interests) : "");
    const wantsNews =
      topicChoice &&
      newsPlanned < NEWS_POSTS_PER_TICK &&
      rng.chance(0.22 + p.openness * 0.25);
    let news: PostTask["news"] = null;
    if (wantsNews) {
      const items = await getNewsForTopic(topicChoice, day, 6);
      if (items.length) {
        const item = new RNG(`${world.seed}:news:${p.id}:${tickNo}`).pick(items);
        news = { topic: topicChoice, id: item.id, title: item.title, url: item.url, source: item.source };
        newsPlanned++;
      }
    }

    const kind = news
      ? "news"
      : rng.weighted([
          ["status", 60],
          ["opinion", 25],
          ["milestone", 15],
        ] as const);
    const rememberIt = kind === "milestone" || rng.chance(0.3);
    postTasks.push({ p, like, kind, mood: p.mood, focus: p.focus, rememberIt, news });
  }

  const generatedPosts = (
    await Promise.all(
      postTasks.map(async (t) => {
        if (t.news) {
          const text = await makeNewsShare(t.like, t.news.title, t.news.topic);
          return text ? { t, text, topic: t.news.topic } : null;
        }
        const made = await makePost(t.like, t.kind, { mood: t.mood, focus: t.focus });
        return made ? { t, text: made.text, topic: made.topic } : null;
      }),
    )
  ).flatMap((g) => (g ? [g] : []));

  for (const g of generatedPosts) {
    const { t } = g;
    if (t.news) {
      await prisma.post.create({
        data: {
          authorId: t.p.id, simDay: day, kind: "news", topic: t.news.topic, text: g.text,
          link: t.news.url, linkTitle: t.news.title, linkSource: t.news.source,
        },
      });
      await markShared(t.news.id);
      await remember(t.p.id, day, "fact", `Read and shared news about ${t.news.topic}: "${trim(t.news.title)}"`, 0.9);
      newsShared++;
    } else {
      await prisma.post.create({
        data: { authorId: t.p.id, simDay: day, kind: t.kind, topic: g.topic, text: g.text },
      });
      if (t.rememberIt) {
        await remember(t.p.id, day, "post", `I posted about ${g.topic ?? "life"}: "${trim(g.text)}"`, 0.6);
      }
    }
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

  // Comments are collected during the sequential scan, then generated in parallel.
  interface CommentTask {
    postId: string;
    kind: string;
    text: string;
    topic: string | null;
    headline: string | null;
    viewerId: string;
    viewerLike: PersonaLike;
    authorName: string;
    authorMood: string;
    memInterest: string | null;
  }
  const commentTasks: CommentTask[] = [];

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

      // comment (rarer) — decide now, generate in parallel after the scan
      if (rng.chance(Math.min(0.22, 0.015 + affinity * 0.4))) {
        bump(relTouch, viewer.id, post.authorId, 0.1 + shared * 0.02);
        let memInterest: string | null = null;
        if (shared > 0 && rng.chance(0.3)) {
          const common = interestsOf(viewer).filter((i) => authorInterests.has(i));
          if (common.length) memInterest = rng.pick(common);
        }
        commentTasks.push({
          postId: post.id, kind: post.kind, text: post.text, topic: post.topic,
          headline: post.linkTitle, viewerId: viewer.id, viewerLike: toPersonaLike(viewer, day),
          authorName: author.firstName, authorMood: author.mood, memInterest,
        });
      }
    }
  }

  // Generate all comment text in parallel (bounded concurrency), then persist.
  const madeComments = (
    await Promise.all(
      commentTasks.map(async (t) => {
        const text = await makeComment(
          t.viewerLike,
          { kind: t.kind, text: t.text, topic: t.topic, headline: t.headline, authorMood: t.authorMood },
          t.authorName,
        );
        return text ? { t, text } : null;
      }),
    )
  ).flatMap((m) => (m ? [m] : []));
  for (const { t, text } of madeComments) {
    await prisma.comment.create({
      data: { postId: t.postId, authorId: t.viewerId, text, simDay: day },
    });
    comments++;
    if (t.memInterest) {
      await remember(t.viewerId, day, "relationship", `Talked with ${t.authorName} about ${t.memInterest}.`, 0.9);
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

  // 6.5) INVITES: like a real social network, existing residents bring in new
  //      people they already know — a colleague, a friend from a hobby, an old
  //      classmate — who share one of their interests and start connected.
  for (const p of alive) {
    if (invites >= INVITES_PER_TICK) break;
    const age = ageOf(p.birthDay, day);
    if (age < 18) continue;
    const pInvite = 0.015 + p.openness * 0.03 + p.extraversion * 0.03;
    if (!rng.chance(pInvite)) continue;

    const inviteRng = new RNG(`${world.seed}:invite:${p.id}:${tickNo}:${invites}`);
    const associate = await inviteAssociate(p, day, inviteRng);
    if (associate) {
      byId.set(associate.id, associate);
      invites++;
      events.push(`👋 ${p.firstName} invited ${associate.firstName} ${associate.lastName} (${associate.via}).`);
    }
  }

  // 7) REFLECTION: some personas pause and distill recent experience into an
  //    insight, which is written into their soul. This is how they grow.
  const stillAlive = await prisma.persona.findMany({
    where: { id: { in: alive.map((p) => p.id) }, alive: true },
    select: { id: true },
  });
  const aliveIds = new Set(stillAlive.map((p) => p.id));

  // Phase 1: decide who reflects + gather context (sequential RNG + reads).
  interface ReflTask { p: Persona; recentMemories: string[] }
  const reflTasks: ReflTask[] = [];
  for (const p of alive) {
    if (!aliveIds.has(p.id)) continue; // died this tick
    const reflectRng = new RNG(`${world.seed}:refl:${p.id}:${tickNo}`);
    if (!reflectRng.chance(0.12 + p.openness * 0.12)) continue;

    const mems = await prisma.memory.findMany({
      where: { personaId: p.id, kind: { in: ["event", "post", "relationship"] } },
      orderBy: [{ simDay: "desc" }],
      take: 6,
    });
    reflTasks.push({ p, recentMemories: mems.map((m) => m.content) });
  }

  // Phase 2: write each insight with the LLM in parallel (skip if none produced).
  const reflected = (
    await Promise.all(
      reflTasks.map(async (t) => {
        const insight = await makeReflection({
          firstName: t.p.firstName,
          occupation: t.p.occupation,
          city: t.p.city,
          age: ageOf(t.p.birthDay, day),
          mood: t.p.mood,
          recentMemories: t.recentMemories,
        });
        return insight ? { t, insight } : null;
      }),
    )
  ).flatMap((r) => (r ? [r] : []));

  // Phase 3: persist the insight + rebuild the soul (sequential).
  for (const { t, insight } of reflected) {
    await remember(t.p.id, day, "reflection", insight, 1.6);
    const insights = (
      await prisma.memory.findMany({
        where: { personaId: t.p.id, kind: "reflection" },
        orderBy: [{ simDay: "desc" }],
        take: 6,
      })
    ).map((m) => m.content);
    const soul = buildSoul(soulInputFor(t.p, day, insights));
    await prisma.persona.update({ where: { id: t.p.id }, data: { soul, soulDay: day } });
    reflections++;
  }

  // 8) commit the clock.
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
    newsShared,
    reflections,
    newRelationships,
    invites,
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

function trim(s: string, n = 90): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function soulInputFor(p: Persona, day: number, insights: string[]): SoulInput {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    pronouns: p.pronouns,
    age: ageOf(p.birthDay, day),
    occupation: p.occupation,
    city: p.city,
    country: p.country,
    interests: interestsOf(p),
    traits: {
      openness: p.openness,
      conscientiousness: p.conscientiousness,
      extraversion: p.extraversion,
      agreeableness: p.agreeableness,
      neuroticism: p.neuroticism,
    },
    bio: p.bio,
    insights,
    day,
  };
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
  // Survivors who were close grieve — a loss event + memory feeds their heartbeat.
  const rels = await prisma.relationship.findMany({
    where: { OR: [{ aId: p.id }, { bId: p.id }], strength: { gte: 0.4 } },
  });
  for (const r of rels) {
    const survivor = r.aId === p.id ? r.bId : r.aId;
    await prisma.lifeEvent.create({
      data: { personaId: survivor, simDay: day, type: "loss", description: `Lost ${p.firstName} ${p.lastName}.` },
    });
    await remember(survivor, day, "event", `Lost ${p.firstName}, someone who mattered to me.`, 2.2);
  }
}

async function linkFamily(childId: string, parentId: string, day: number) {
  const [aId, bId] = pairKey(childId, parentId);
  await prisma.relationship.upsert({
    where: { aId_bId: { aId, bId } },
    create: { aId, bId, type: "family", strength: 1, sinceDay: day },
    update: { type: "family", strength: 1 },
  });
}

async function linkRelationship(a: string, b: string, type: string, strength: number, day: number) {
  const [aId, bId] = pairKey(a, b);
  await prisma.relationship.upsert({
    where: { aId_bId: { aId, bId } },
    create: { aId, bId, type, strength, sinceDay: day },
    update: { type, strength },
  });
}

/**
 * An existing resident invites a new associate they already know — someone who
 * shares one of their interests, met through work/hobby/school/neighborhood, and
 * who starts already connected. Returns the new persona (+ how they know each
 * other), or null if the inviter has no interests.
 */
async function inviteAssociate(inviter: Persona, day: number, rng: RNG) {
  const interests = interestsOf(inviter);
  if (!interests.length) return null;
  const shared = rng.pick(interests);
  const context = rng.weighted([
    ["work", 3], ["hobby", 4], ["school", 2], ["neighborhood", 2],
  ] as const);

  const inviterAge = ageOf(inviter.birthDay, day);
  const forcedAge =
    context === "school"
      ? Math.max(18, Math.min(90, inviterAge + rng.int(-3, 3)))
      : rng.int(22, 68);

  const gen = generatePersona(`${inviter.seed}:assoc:${day}:${rng.int(0, 1e9)}`, day, forcedAge);
  if (!gen.interests.includes(shared)) gen.interests[0] = shared; // the tie that binds
  if (context === "work") gen.occupation = inviter.occupation;
  if (context === "school" || context === "neighborhood") {
    gen.city = inviter.city;
    gen.country = inviter.country;
  }

  const associate = await createPersona(gen, day);

  const meta = {
    work: { type: "friend", strength: 0.4, via: "a colleague",
      inv: `Brought my colleague ${gen.firstName} into the network.`,
      ass: `${inviter.firstName} invited me in — we work together.` },
    hobby: { type: "friend", strength: 0.4, via: `a friend from ${shared}`,
      inv: `Invited ${gen.firstName}, a friend from ${shared}.`,
      ass: `${inviter.firstName} invited me in — we know each other through ${shared}.` },
    school: { type: "close_friend", strength: 0.55, via: "an old classmate",
      inv: `Reconnected with ${gen.firstName}, an old classmate.`,
      ass: `${inviter.firstName} invited me in — we go way back to school.` },
    neighborhood: { type: "acquaintance", strength: 0.25, via: "a neighbor",
      inv: `Invited my neighbor ${gen.firstName}.`,
      ass: `${inviter.firstName}, my neighbor, invited me in.` },
  }[context];

  await linkRelationship(inviter.id, associate.id, meta.type, meta.strength, day);
  await prisma.lifeEvent.create({
    data: { personaId: associate.id, simDay: day, type: "milestone",
      description: `Joined the network, invited by ${inviter.firstName}.` },
  });
  await remember(inviter.id, day, "relationship", meta.inv, 1.0);
  await remember(associate.id, day, "relationship", meta.ass, 1.0);

  return Object.assign(associate, { via: meta.via });
}

export async function createPersona(gen: ReturnType<typeof generatePersona>, day: number) {
  const age = ageOf(gen.birthDay, day);
  const soul = buildSoul({
    firstName: gen.firstName,
    lastName: gen.lastName,
    pronouns: gen.pronouns,
    age,
    occupation: gen.occupation,
    city: gen.city,
    country: gen.country,
    interests: gen.interests,
    traits: {
      openness: gen.openness,
      conscientiousness: gen.conscientiousness,
      extraversion: gen.extraversion,
      agreeableness: gen.agreeableness,
      neuroticism: gen.neuroticism,
    },
    bio: gen.bio,
    day,
  });
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
      soul,
      soulDay: day,
      mood: age < 2 ? "content" : "curious",
      focus: gen.interests[0] ?? "",
      energy: 0.6,
      heartbeatDay: day,
    },
  });
  await prisma.memory.create({
    data: {
      personaId: persona.id,
      simDay: gen.birthDay,
      kind: "fact",
      content: `I'm ${gen.firstName}, ${gen.occupation === "toddler" ? "just starting out" : `a ${gen.occupation}`} in ${gen.city}.`,
      weight: 1,
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
