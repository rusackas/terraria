import Link from "next/link";
import { notFound } from "next/navigation";
import { getPerson } from "@/lib/queries";
import { Avatar } from "@/components/Avatar";
import { simDate } from "@/lib/time";

export const dynamic = "force-dynamic";

const TRAIT_LABELS: Record<string, string> = {
  openness: "Openness",
  conscientiousness: "Conscientiousness",
  extraversion: "Extraversion",
  agreeableness: "Agreeableness",
  neuroticism: "Neuroticism",
};

const REL_LABEL: Record<string, string> = {
  acquaintance: "Acquaintance",
  friend: "Friend",
  close_friend: "Close friend",
  partner: "Partner",
  spouse: "Spouse",
  family: "Family",
  rival: "Rival",
};

const EVENT_ICON: Record<string, string> = {
  birth: "🌱",
  job: "💼",
  move: "📦",
  relationship: "💞",
  child: "👶",
  illness: "🤒",
  death: "🕯️",
  milestone: "⭐",
};

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPerson(id);
  if (!p) notFound();

  const current = p.avatars.find((a) => a.current) ?? p.avatars[p.avatars.length - 1];

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="card p-5">
        <div className="flex items-start gap-4">
          <Avatar svg={current?.svg ?? null} size={96} alt={p.firstName} ring dim={!p.alive} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {p.firstName} {p.lastName}
            </h1>
            <p className="text-sm text-[var(--muted)]">
              {p.age} years old · {p.pronouns} · {p.occupation}
            </p>
            <p className="text-sm text-[var(--muted)]">
              {p.city}, {p.country} · {p.education}
            </p>
            {!p.alive && p.deathDay != null && (
              <p className="mt-1 text-sm">🕯️ Passed away {simDate(p.deathDay)}</p>
            )}
            <p className="mt-2 text-[0.95rem]">{p.bio}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.interests.map((i) => (
                <span key={i} className="chip">
                  {i}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Aging portrait gallery */}
      {p.avatars.length > 1 && (
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide">
            Through the years
          </h2>
          <div className="mt-3 flex gap-4 overflow-x-auto pb-1">
            {p.avatars.map((a, i) => (
              <div key={i} className="text-center shrink-0">
                <Avatar svg={a.svg} size={64} alt={`age ${a.ageYears}`} ring={a.current} />
                <div className="mt-1 text-xs text-[var(--muted)]">age {a.ageYears}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Personality */}
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide">
            Personality
          </h2>
          <div className="mt-3 space-y-2.5">
            {Object.entries(p.traits).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span>{TRAIT_LABELS[k]}</span>
                  <span className="text-[var(--muted)] tabular-nums">{Math.round(v * 100)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${v * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Relationships */}
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide">
            Relationships ({p.relationships.length})
          </h2>
          <div className="mt-3 space-y-2 max-h-72 overflow-y-auto">
            {p.relationships.length === 0 && (
              <p className="text-sm text-[var(--muted)]">No connections yet.</p>
            )}
            {p.relationships.slice(0, 30).map((r) => (
              <Link
                key={r.id}
                href={`/people/${r.id}`}
                className="flex items-center gap-2.5 hover:bg-[var(--surface-2)] rounded-lg p-1 -m-1 transition-colors"
              >
                <Avatar svg={r.avatarSvg} size={32} alt={r.name} dim={!r.alive} />
                <span className="text-sm truncate flex-1">{r.name}</span>
                <span
                  className={
                    r.type === "partner" || r.type === "spouse" || r.type === "family"
                      ? "chip"
                      : "text-xs text-[var(--muted)]"
                  }
                >
                  {REL_LABEL[r.type] ?? r.type}
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* Life timeline */}
      {p.lifeEvents.length > 0 && (
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide">
            Life events
          </h2>
          <ol className="mt-3 space-y-2">
            {p.lifeEvents.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 text-sm">
                <span aria-hidden>{EVENT_ICON[e.type] ?? "•"}</span>
                <span className="flex-1">{e.description}</span>
                <span className="text-xs text-[var(--muted)] tabular-nums">{simDate(e.simDay)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Posts */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wide">
          Posts
        </h2>
        <div className="mt-3 space-y-3">
          {p.posts.length === 0 && (
            <p className="text-sm text-[var(--muted)]">Hasn&apos;t posted yet.</p>
          )}
          {p.posts.map((post) => (
            <div key={post.id} className="border-b border-[var(--border)] last:border-0 pb-3 last:pb-0">
              <p className="text-[0.95rem]">{post.text}</p>
              <div className="mt-1 text-xs text-[var(--muted)] flex gap-3">
                <span>{simDate(post.simDay)}</span>
                {post.reactionTotal > 0 && <span>♥ {post.reactionTotal}</span>}
                {post.commentTotal > 0 && <span>💬 {post.commentTotal}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
