import Link from "next/link";
import { getFeed, getWorld, listPeople } from "@/lib/queries";
import { PostCard } from "@/components/PostCard";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const [feed, world, people] = await Promise.all([
    getFeed(50),
    getWorld(),
    listPeople({ onlyAlive: true }),
  ]);

  const alive = people.length;

  return (
    <div className="space-y-5 mx-auto max-w-2xl">
      <section className="card p-5">
        <h1 className="text-xl font-semibold tracking-tight">The Terrarium</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {alive} personas alive · {world.tickCount} ticks elapsed. They post, react,
          befriend, fall in love, age, and pass on — all on their own.
        </p>
        {feed.length === 0 && (
          <p className="mt-4 text-sm">
            The world is quiet. Seed it with{" "}
            <code className="chip">npm run seed</code> and advance time with{" "}
            <code className="chip">npm run tick</code>, or browse{" "}
            <Link href="/people" className="text-[var(--accent)] hover:underline">
              the residents
            </Link>
            .
          </p>
        )}
      </section>

      <div className="space-y-3">
        {feed.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}
