import { prisma } from "./db";
import { ageOf } from "./time";

export async function getWorld() {
  return prisma.world.upsert({
    where: { id: "world" },
    create: { id: "world" },
    update: {},
  });
}

export interface FeedPost {
  id: string;
  simDay: number;
  kind: string;
  text: string;
  author: { id: string; firstName: string; lastName: string; avatarSvg: string | null };
  reactions: { type: string; count: number }[];
  reactionTotal: number;
  comments: {
    id: string;
    text: string;
    simDay: number;
    author: { id: string; firstName: string; lastName: string };
  }[];
}

export async function getFeed(limit = 40): Promise<FeedPost[]> {
  const posts = await prisma.post.findMany({
    orderBy: [{ simDay: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      author: { include: { avatars: { where: { current: true }, take: 1 } } },
      reactions: { select: { type: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        take: 3,
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });

  return posts.map((p) => {
    const counts = new Map<string, number>();
    for (const r of p.reactions) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
    return {
      id: p.id,
      simDay: p.simDay,
      kind: p.kind,
      text: p.text,
      author: {
        id: p.author.id,
        firstName: p.author.firstName,
        lastName: p.author.lastName,
        avatarSvg: p.author.avatars[0]?.svg ?? null,
      },
      reactions: [...counts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      reactionTotal: p.reactions.length,
      comments: p.comments.map((c) => ({
        id: c.id,
        text: c.text,
        simDay: c.simDay,
        author: c.author,
      })),
    };
  });
}

export async function listPeople(opts: { q?: string; onlyAlive?: boolean } = {}) {
  const world = await getWorld();
  const people = await prisma.persona.findMany({
    where: {
      alive: opts.onlyAlive ? true : undefined,
      OR: opts.q
        ? [
            { firstName: { contains: opts.q } },
            { lastName: { contains: opts.q } },
            { city: { contains: opts.q } },
            { occupation: { contains: opts.q } },
          ]
        : undefined,
    },
    orderBy: [{ alive: "desc" }, { birthDay: "asc" }],
    include: { avatars: { where: { current: true }, take: 1 } },
    take: 300,
  });

  return people.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    city: p.city,
    country: p.country,
    occupation: p.occupation,
    alive: p.alive,
    age: ageOf(p.birthDay, p.deathDay ?? world.currentDay),
    avatarSvg: p.avatars[0]?.svg ?? null,
  }));
}

export async function getPerson(id: string) {
  const world = await getWorld();
  const p = await prisma.persona.findUnique({
    where: { id },
    include: {
      avatars: { orderBy: { simDay: "asc" } },
      posts: {
        orderBy: { simDay: "desc" },
        take: 30,
        include: { reactions: { select: { type: true } }, comments: { select: { id: true } } },
      },
      lifeEvents: { orderBy: { simDay: "desc" }, take: 40 },
      memories: { orderBy: [{ weight: "desc" }, { simDay: "desc" }], take: 20 },
    },
  });
  if (!p) return null;

  // relationships (both directions)
  const rels = await prisma.relationship.findMany({
    where: { OR: [{ aId: id }, { bId: id }] },
    orderBy: { strength: "desc" },
    take: 60,
  });
  const otherIds = rels.map((r) => (r.aId === id ? r.bId : r.aId));
  const others = await prisma.persona.findMany({
    where: { id: { in: otherIds } },
    include: { avatars: { where: { current: true }, take: 1 } },
  });
  const otherMap = new Map(others.map((o) => [o.id, o]));

  const relationships = rels
    .map((r) => {
      const oid = r.aId === id ? r.bId : r.aId;
      const o = otherMap.get(oid);
      if (!o) return null;
      return {
        id: o.id,
        name: `${o.firstName} ${o.lastName}`,
        type: r.type,
        strength: r.strength,
        alive: o.alive,
        avatarSvg: o.avatars[0]?.svg ?? null,
      };
    })
    .filter(Boolean) as {
    id: string;
    name: string;
    type: string;
    strength: number;
    alive: boolean;
    avatarSvg: string | null;
  }[];

  const endDay = p.deathDay ?? world.currentDay;

  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    pronouns: p.pronouns,
    gender: p.gender,
    bio: p.bio,
    city: p.city,
    country: p.country,
    occupation: p.occupation,
    education: p.education,
    alive: p.alive,
    age: ageOf(p.birthDay, endDay),
    birthDay: p.birthDay,
    deathDay: p.deathDay,
    interests: safeJson(p.interests),
    traits: {
      openness: p.openness,
      conscientiousness: p.conscientiousness,
      extraversion: p.extraversion,
      agreeableness: p.agreeableness,
      neuroticism: p.neuroticism,
    },
    avatars: p.avatars.map((a) => ({ svg: a.svg, ageYears: a.ageYears, simDay: a.simDay, current: a.current })),
    posts: p.posts.map((post) => ({
      id: post.id,
      text: post.text,
      kind: post.kind,
      simDay: post.simDay,
      reactionTotal: post.reactions.length,
      commentTotal: post.comments.length,
    })),
    lifeEvents: p.lifeEvents.map((e) => ({ id: e.id, type: e.type, description: e.description, simDay: e.simDay })),
    memories: p.memories.map((m) => ({ id: m.id, kind: m.kind, content: m.content, simDay: m.simDay })),
    relationships,
    world,
  };
}

function safeJson(s: string): string[] {
  try {
    return JSON.parse(s) as string[];
  } catch {
    return [];
  }
}
