// Advance the world clock. Usage: npm run tick -- [numTicks]

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { tick } from "../src/lib/sim";

async function main() {
  const n = parseInt(process.argv[2] || "1", 10);
  for (let i = 0; i < n; i++) {
    const r = await tick();
    console.log(
      `⏱  tick ${r.tick} — ${r.date} | pop ${r.population} | ` +
        `posts ${r.posts} comments ${r.comments} reactions ${r.reactions} | ` +
        `+rels ${r.newRelationships} births ${r.births} deaths ${r.deaths}`,
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
