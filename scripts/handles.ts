// Let personas pick their own social handles (via the LLM). Backfills anyone
// missing one. Usage: npm run handles   (or: npm run handles -- --all)

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { ensureOllamaReady } from "../src/lib/llm";
import { generateHandle } from "../src/lib/handle";

async function main() {
  const all = process.argv.includes("--all");
  const ready = await ensureOllamaReady();
  if (!ready.ok) {
    console.error(`⚠️  ${ready.note}`);
    process.exit(1);
  }

  const people = await prisma.persona.findMany({ where: all ? {} : { handle: null } });
  console.log(`🏷  Picking handles for ${people.length} persona${people.length === 1 ? "" : "s"}…`);

  // Reserve handles already held by personas we're NOT reassigning.
  const taken = new Set<string>();
  if (!all) {
    for (const h of await prisma.persona.findMany({ where: { handle: { not: null } }, select: { handle: true } })) {
      if (h.handle) taken.add(h.handle);
    }
  }

  // Generate in parallel (bounded by the LLM concurrency limiter), assign uniquely.
  const bases = await Promise.all(
    people.map((p) =>
      generateHandle({
        firstName: p.firstName,
        occupation: p.occupation,
        interests: safe(p.interests),
      }),
    ),
  );

  let done = 0;
  for (let i = 0; i < people.length; i++) {
    let base = bases[i];
    if (!base) continue;
    let h = base;
    let n = 1;
    while (taken.has(h)) h = `${base}${n++}`;
    taken.add(h);
    await prisma.persona.update({ where: { id: people[i].id }, data: { handle: h } });
    done++;
    if (done % 5 === 0) console.log(`  …${done}/${people.length}`);
  }

  console.log(`✅ ${done} handles assigned.`);
  await prisma.$disconnect();
}

function safe(s: string): string[] {
  try {
    return JSON.parse(s) as string[];
  } catch {
    return [];
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
