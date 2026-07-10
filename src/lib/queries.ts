import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { ageOf } from "./time";

// Shared include + mapper so the global feed and a persona's home feed stay in sync.
const feedPostInclude = Prisma.validator<Prisma.PostInclude>()({
  author: { include: { avatars: { where: { current: true }, take: 1 } } },
  reactions: { select: { type: true } },
  comments: {
    orderBy: { createdAt: "asc" },
    take: 3,
    include: { author: { select: { id: true, handle: true, firstName: true, lastName: true } } },
  },
});
type FeedPostRow = Prisma.PostGetPayload<{ include: typeof feedPostInclude }>;

function toFeedPost(p: FeedPostRow): FeedPost {
  const counts = new Map<string, number>();
  for (const r of p.reactions) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  return {
    id: p.id,
    simDay: p.simDay,
    createdAt: p.createdAt.toISOString(),
    kind: p.kind,
    text: p.text,
    image: p.image,
    link: p.link,
    linkTitle: p.linkTitle,
    linkSource: p.linkSource,
    author: {
      id: p.author.id,
      handle: p.author.handle,
      firstName: p.author.firstName,
      lastName: p.author.lastName,
      avatarSvg: p.author.avatars[0]?.svg ?? null,
      avatarPhoto: p.author.avatars[0]?.photo ?? null,
    },
    reactions: [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    reactionTotal: p.reactions.length,
    comments: p.comments.map((c) => ({
      id: c.id,
      text: c.text,
      simDay: c.simDay,
      createdAt: c.createdAt.toISOString(),
      author: c.author,
    })),
  };
}

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
  createdAt: string; // real-world generation time (ISO)
  kind: string;
  text: string;
  image: string | null;
  link: string | null;
  linkTitle: string | null;
  linkSource: string | null;
  author: { id: string; handle: string | null; firstName: string; lastName: string; avatarSvg: string | null; avatarPhoto: string | null };
  reactions: { type: string; count: number }[];
  reactionTotal: number;
  comments: {
    id: string;
    text: string;
    simDay: number;
    createdAt: string; // real-world generation time (ISO)
    author: { id: string; handle: string | null; firstName: string; lastName: string };
  }[];
}

export async function getFeed(limit = 40): Promise<FeedPost[]> {
  const posts = await prisma.post.findMany({
    orderBy: [{ simDay: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: feedPostInclude,
  });
  return posts.map(toFeedPost);
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
    handle: p.handle,
    firstName: p.firstName,
    lastName: p.lastName,
    city: p.city,
    country: p.country,
    occupation: p.occupation,
    alive: p.alive,
    age: ageOf(p.birthDay, p.deathDay ?? world.currentDay),
    avatarSvg: p.avatars[0]?.svg ?? null,
    avatarPhoto: p.avatars[0]?.photo ?? null,
  }));
}

export async function getPerson(slug: string) {
  const world = await getWorld();
  // Accept either a handle or a raw id.
  const p = await prisma.persona.findFirst({
    where: { OR: [{ handle: slug }, { id: slug }] },
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
  const id = p.id;

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
        handle: o.handle,
        name: `${o.firstName} ${o.lastName}`,
        type: r.type,
        strength: r.strength,
        alive: o.alive,
        avatarSvg: o.avatars[0]?.svg ?? null,
        avatarPhoto: o.avatars[0]?.photo ?? null,
      };
    })
    .filter(Boolean) as {
    id: string;
    handle: string | null;
    name: string;
    type: string;
    strength: number;
    alive: boolean;
    avatarSvg: string | null;
    avatarPhoto: string | null;
  }[];

  // People You May Know: friends-of-friends (one degree out), ranked by mutual
  // connections then shared interests, excluding people already connected.
  const directSet = new Set(otherIds);
  const connectedOrSelf = new Set([...otherIds, id]);
  const secondRels = otherIds.length
    ? await prisma.relationship.findMany({
        where: { OR: [{ aId: { in: otherIds } }, { bId: { in: otherIds } }] },
        select: { aId: true, bId: true },
      })
    : [];
  const mutualMap = new Map<string, Set<string>>(); // candidate -> shared friends
  for (const r of secondRels) {
    const aDirect = directSet.has(r.aId);
    const bDirect = directSet.has(r.bId);
    let friend: string, cand: string;
    if (aDirect && !bDirect) { friend = r.aId; cand = r.bId; }
    else if (bDirect && !aDirect) { friend = r.bId; cand = r.aId; }
    else continue;
    if (connectedOrSelf.has(cand)) continue;
    let set = mutualMap.get(cand);
    if (!set) mutualMap.set(cand, (set = new Set()));
    set.add(friend);
  }
  const myInterests = new Set(safeJson(p.interests));
  const candidates = mutualMap.size
    ? await prisma.persona.findMany({
        where: { id: { in: [...mutualMap.keys()] }, alive: true },
        include: { avatars: { where: { current: true }, take: 1 } },
      })
    : [];
  const peopleYouMayKnow = candidates
    .map((c) => {
      const shared = safeJson(c.interests).filter((x) => myInterests.has(x));
      return {
        id: c.id,
        handle: c.handle,
        name: `${c.firstName} ${c.lastName}`,
        occupation: c.occupation,
        city: c.city,
        avatarSvg: c.avatars[0]?.svg ?? null,
        avatarPhoto: c.avatars[0]?.photo ?? null,
        mutual: mutualMap.get(c.id)!.size,
        sharedInterests: shared,
      };
    })
    .sort((a, b) => b.mutual - a.mutual || b.sharedInterests.length - a.sharedInterests.length)
    .slice(0, 6);

  // Home feed — what this persona would see: their own posts + their connections',
  // newest first, like scrolling their own social feed.
  const feedAuthorIds = [id, ...otherIds];
  const hfPosts = await prisma.post.findMany({
    where: { authorId: { in: feedAuthorIds } },
    orderBy: [{ simDay: "desc" }, { createdAt: "desc" }],
    take: 30,
    include: feedPostInclude,
  });
  const homeFeed = hfPosts.map(toFeedPost);

  const endDay = p.deathDay ?? world.currentDay;

  return {
    id: p.id,
    handle: p.handle,
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
    soul: p.soul,
    mood: p.mood,
    focus: p.focus,
    energy: p.energy,
    interests: safeJson(p.interests),
    traits: {
      openness: p.openness,
      conscientiousness: p.conscientiousness,
      extraversion: p.extraversion,
      agreeableness: p.agreeableness,
      neuroticism: p.neuroticism,
    },
    avatars: p.avatars.map((a) => ({ svg: a.svg, photo: a.photo, ageYears: a.ageYears, simDay: a.simDay, current: a.current })),
    posts: p.posts.map((post) => ({
      id: post.id,
      text: post.text,
      kind: post.kind,
      simDay: post.simDay,
      image: post.image,
      link: post.link,
      linkTitle: post.linkTitle,
      linkSource: post.linkSource,
      reactionTotal: post.reactions.length,
      commentTotal: post.comments.length,
    })),
    lifeEvents: p.lifeEvents.map((e) => ({ id: e.id, type: e.type, description: e.description, simDay: e.simDay })),
    memories: p.memories.map((m) => ({ id: m.id, kind: m.kind, content: m.content, simDay: m.simDay })),
    relationships,
    peopleYouMayKnow,
    homeFeed,
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
