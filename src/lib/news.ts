// Real-world news for personas to share. Uses public Google News RSS search
// (no API key). Results are cached in the DB per topic and deduped so the same
// headline isn't reposted. Fully graceful offline — returns [] and the sim falls
// back to ordinary posts.

import { prisma } from "./db";

const NEWS_STALE_DAYS = 21; // refetch a topic if the cache is older than this
const NEWS_DISABLED = process.env.TERRARIA_NEWS_DISABLED === "1";
const UA =
  "Mozilla/5.0 (compatible; TerrariaBot/1.0; +https://github.com/rusackas/terraria)";

export interface Headline {
  title: string;
  url: string;
  source: string | null;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Fetch and parse Google News RSS for a query. Never throws. */
export async function fetchHeadlines(query: string): Promise<Headline[]> {
  if (NEWS_DISABLED) return [];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query,
  )}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml);
  } catch (err) {
    console.warn(`[terraria] news fetch failed for "${query}":`, (err as Error).message);
    return [];
  }
}

function parseRss(xml: string): Headline[] {
  const items = xml.split(/<item>/).slice(1);
  const out: Headline[] = [];
  for (const raw of items) {
    const chunk = raw.split(/<\/item>/)[0];
    const titleRaw = /<title>([\s\S]*?)<\/title>/.exec(chunk)?.[1];
    const link = /<link>([\s\S]*?)<\/link>/.exec(chunk)?.[1]?.trim();
    const source = /<source[^>]*>([\s\S]*?)<\/source>/.exec(chunk)?.[1];
    if (!titleRaw || !link) continue;
    let title = decode(titleRaw);
    const src = source ? decode(source) : null;
    // Google News titles are "Headline - Publisher" — trim the trailing publisher.
    if (src && title.endsWith(` - ${src}`)) title = title.slice(0, -(src.length + 3)).trim();
    if (title.length < 12) continue;
    out.push({ title, url: link, source: src });
  }
  return out.slice(0, 12);
}

/**
 * Return usable news items for a topic, refreshing the cache when stale/empty.
 * Prefers headlines that haven't been shared yet.
 */
export async function getNewsForTopic(topic: string, day: number, limit = 6) {
  const fresh = await prisma.newsItem.findMany({
    where: { topic, fetchedDay: { gte: day - NEWS_STALE_DAYS } },
    orderBy: [{ sharedCount: "asc" }, { fetchedDay: "desc" }],
    take: 25,
  });

  if (fresh.length >= 3) return fresh.slice(0, limit);

  // Cache is thin — fetch more.
  const headlines = await fetchHeadlines(topic);
  for (const h of headlines) {
    try {
      await prisma.newsItem.upsert({
        where: { url: h.url },
        create: { topic, title: h.title, url: h.url, source: h.source, fetchedDay: day },
        update: { fetchedDay: day },
      });
    } catch {
      // ignore races / dup urls
    }
  }

  return prisma.newsItem.findMany({
    where: { topic },
    orderBy: [{ sharedCount: "asc" }, { fetchedDay: "desc" }],
    take: limit,
  });
}

export async function markShared(id: string) {
  await prisma.newsItem.update({
    where: { id },
    data: { sharedCount: { increment: 1 } },
  }).catch(() => {});
}
