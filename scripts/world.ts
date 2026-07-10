// Run the world locally, forever. Ticks on an interval so you can leave it going
// and watch the terrarium evolve — the local-first replacement for a cron.
//
// Usage:
//   npm run world              # one tick every 10 minutes (default)
//   npm run world -- 60        # one tick per minute
//   TERRARIA_INTERVAL=30 npm run world
//
// Ctrl-C stops cleanly after the current tick finishes.

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { tick } from "../src/lib/sim";
import { backend } from "../src/lib/llm";

const intervalSec = parseInt(
  process.argv[2] || process.env.TERRARIA_INTERVAL || "600",
  10,
);

let running = true;
let ticking = false;
process.on("SIGINT", () => {
  if (!running) process.exit(0); // second Ctrl-C = force quit
  console.log(
    ticking
      ? "\n🌙 Stopping after the current tick finishes…"
      : "\n🌙 Stopping.",
  );
  running = false;
});

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

async function main() {
  // WAL lets you view the world in the browser (npm run dev) while it ticks,
  // without SQLite write-lock contention. Persists on the db file once set.
  // (PRAGMA returns a row, so use $queryRawUnsafe, not $executeRawUnsafe.)
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");

  console.log(
    `🌍 Running the world — one tick every ${intervalSec}s. ` +
      `LLM backend: ${backend()}. Press Ctrl-C to stop.\n`,
  );

  while (running) {
    ticking = true;
    const r = await tick();
    ticking = false;
    console.log(
      `⏱  tick ${r.tick} — ${r.date} | pop ${r.population} | ` +
        `posts ${r.posts} (news ${r.newsShared}) comments ${r.comments} reactions ${r.reactions} | ` +
        `reflections ${r.reflections} +rels ${r.newRelationships} invites ${r.invites} births ${r.births} deaths ${r.deaths}`,
    );
    for (const e of r.events) console.log(`     ${e}`);
    if (!running) break;
    await sleep(intervalSec * 1000);
  }

  await prisma.$disconnect();
  console.log("🌙 World paused. Run `npm run world` to resume where it left off.");
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
