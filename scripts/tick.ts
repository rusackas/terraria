// Advance the world clock. Usage: npm run tick -- [numTicks]

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { tick } from "../src/lib/sim";
import { ensureOllamaReady } from "../src/lib/llm";

async function main() {
  const ready = await ensureOllamaReady();
  if (!ready.ok) {
    console.error(`⚠️  ${ready.note}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const n = parseInt(process.argv[2] || "1", 10);
  for (let i = 0; i < n; i++) {
    const r = await tick();
    console.log(
      `⏱  tick ${r.tick} — ${r.date} | pop ${r.population} | ` +
        `posts ${r.posts} (news ${r.newsShared}) comments ${r.comments} reactions ${r.reactions} | ` +
        `reflections ${r.reflections} +rels ${r.newRelationships} invites ${r.invites} births ${r.births} deaths ${r.deaths}`,
    );
    for (const e of r.events) console.log(`     ${e}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
