import Link from "next/link";
import { Avatar } from "./Avatar";
import { simDate } from "@/lib/time";
import type { FeedPost } from "@/lib/queries";

const REACTION_EMOJI: Record<string, string> = {
  like: "👍",
  love: "❤️",
  laugh: "😄",
  wow: "😮",
  sad: "😢",
  angry: "😠",
};

const KIND_LABEL: Record<string, string> = {
  status: "status",
  opinion: "opinion",
  milestone: "milestone",
  life_event: "life event",
  news: "news",
  photo: "new photo",
};

export function PostCard({ post }: { post: FeedPost }) {
  const isPhoto = post.kind === "photo" && !!post.image;
  return (
    <article className="card p-4">
      <div className="flex items-start gap-3">
        <Link href={`/people/${post.author.handle ?? post.author.id}`}>
          <Avatar svg={post.author.avatarSvg} photo={post.author.avatarPhoto} size={44} alt={post.author.firstName} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/people/${post.author.handle ?? post.author.id}`}
              className="font-semibold hover:underline underline-offset-2"
            >
              {post.author.firstName} {post.author.lastName}
            </Link>
            {post.author.handle && (
              <span className="text-xs text-[var(--muted)]">{`@${post.author.handle}`}</span>
            )}
            <span className="chip">{KIND_LABEL[post.kind] ?? post.kind}</span>
            <span className="text-xs text-[var(--muted)] ml-auto tabular-nums">
              {simDate(post.simDay)}
            </span>
          </div>

          {isPhoto ? (
            <>
              <p className="mt-1.5 text-sm text-[var(--muted)]">
                updated their profile picture{post.text ? ` — ${post.text}` : ""}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={post.image!}
                alt={`${post.author.firstName}'s new profile picture`}
                className="mt-2 rounded-xl border border-[var(--border)] w-full max-w-[280px] aspect-square object-cover"
                loading="lazy"
              />
            </>
          ) : (
            post.text && <p className="mt-1.5 text-[0.95rem] leading-relaxed">{post.text}</p>
          )}

          {post.link && (
            <a
              href={post.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5 hover:border-[var(--accent)] transition-colors"
            >
              <span aria-hidden className="text-base">🔗</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{post.linkTitle}</span>
                {post.linkSource && (
                  <span className="block text-xs text-[var(--muted)] truncate">{post.linkSource}</span>
                )}
              </span>
            </a>
          )}

          <div className="mt-3 flex items-center gap-3 text-xs text-[var(--muted)]">
            {post.reactionTotal > 0 && (
              <span className="flex items-center gap-1">
                <span className="flex -space-x-1">
                  {post.reactions.slice(0, 3).map((r) => (
                    <span key={r.type} aria-hidden>
                      {REACTION_EMOJI[r.type] ?? "•"}
                    </span>
                  ))}
                </span>
                {post.reactionTotal}
              </span>
            )}
            {post.comments.length > 0 && <span>💬 {post.comments.length}</span>}
          </div>

          {post.comments.length > 0 && (
            <div className="mt-3 space-y-2 border-l-2 border-[var(--border)] pl-3">
              {post.comments.map((c) => (
                <div key={c.id} className="text-sm">
                  <Link
                    href={`/people/${c.author.handle ?? c.author.id}`}
                    className="font-medium hover:underline underline-offset-2"
                  >
                    {c.author.firstName}
                  </Link>{" "}
                  <span className="text-[var(--text)]/90">{c.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
