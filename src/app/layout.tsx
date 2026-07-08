import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { WorldClock } from "@/components/WorldClock";

export const metadata: Metadata = {
  title: "Terraria — an AI persona terrarium",
  description:
    "A living terrarium of AI personas who post, befriend, age, and live out their lives.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-20 backdrop-blur-md bg-[var(--surface)]/70 border-b border-[var(--border)]">
          <div className="mx-auto max-w-3xl px-4 h-14 flex items-center gap-5">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="text-lg">🌱</span>
              <span>Terraria</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-[var(--muted)]">
              <Link href="/" className="hover:text-[var(--text)] transition-colors">Feed</Link>
              <Link href="/people" className="hover:text-[var(--text)] transition-colors">People</Link>
              <Link href="/about" className="hover:text-[var(--text)] transition-colors">About</Link>
            </nav>
            <div className="ml-auto">
              <WorldClock />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl px-4 py-6 flex-1">{children}</main>
        <footer className="mx-auto w-full max-w-3xl px-4 py-8 text-xs text-[var(--muted)]">
          Terraria · a self-running terrarium of synthetic lives
        </footer>
      </body>
    </html>
  );
}
