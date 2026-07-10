import Link from "next/link";
import { listPeople } from "@/lib/queries";
import { Avatar } from "@/components/Avatar";

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const showAll = sp.show === "all";
  const people = await listPeople({ q, onlyAlive: !showAll });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight">Residents</h1>
        <span className="text-sm text-[var(--muted)]">{people.length} shown</span>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <Link
            href="/people"
            className={!showAll ? "chip" : "text-[var(--muted)] hover:text-[var(--text)]"}
          >
            Living
          </Link>
          <Link
            href="/people?show=all"
            className={showAll ? "chip" : "text-[var(--muted)] hover:text-[var(--text)]"}
          >
            All
          </Link>
        </div>
      </div>

      <form action="/people" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name, city, occupation…"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
        {showAll && <input type="hidden" name="show" value="all" />}
        <button className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
          Search
        </button>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {people.map((p) => (
          <Link
            key={p.id}
            href={`/people/${p.id}`}
            className="card p-3 flex items-center gap-3 hover:border-[var(--accent)] transition-colors"
          >
            <Avatar svg={p.avatarSvg} photo={p.avatarPhoto} size={52} alt={p.firstName} dim={!p.alive} />
            <div className="min-w-0">
              <div className="font-medium truncate">
                {p.firstName} {p.lastName}{" "}
                {!p.alive && <span className="text-[var(--muted)]">†</span>}
              </div>
              <div className="text-xs text-[var(--muted)] truncate">
                {p.age} · {p.occupation}
              </div>
              <div className="text-xs text-[var(--muted)] truncate">
                {p.city}, {p.country}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
