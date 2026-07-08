// Materialize every persona's agent state as on-disk markdown files:
//   souls/<name>-<id>/soul.md, memory.md, heartbeat.md
// A browsable, git-friendly "terrarium of souls". Usage: npm run souls

import "dotenv/config";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/db";
import { simDate, ageOf } from "../src/lib/time";

const OUT = join(process.cwd(), "souls");

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function main() {
  const onlyAlive = process.argv.includes("--alive");
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const world = await prisma.world.findUnique({ where: { id: "world" } });
  const day = world?.currentDay ?? 0;

  const people = await prisma.persona.findMany({
    where: onlyAlive ? { alive: true } : {},
    include: {
      memories: { orderBy: [{ simDay: "asc" }] },
      lifeEvents: { orderBy: { simDay: "asc" } },
    },
  });

  for (const p of people) {
    const dir = join(OUT, `${slug(`${p.firstName}-${p.lastName}`)}-${p.id.slice(-6)}`);
    await mkdir(dir, { recursive: true });

    // soul.md
    await writeFile(join(dir, "soul.md"), p.soul || "# (soul not yet formed)\n");

    // heartbeat.md
    const hb = [
      `# Heartbeat — ${p.firstName} ${p.lastName}`,
      "",
      `- **Status:** ${p.alive ? `alive, age ${ageOf(p.birthDay, day)}` : `died ${p.deathDay != null ? simDate(p.deathDay) : "?"}`}`,
      `- **Mood:** ${p.mood}`,
      `- **Focus:** ${p.focus || "—"}`,
      `- **Energy:** ${Math.round(p.energy * 100)}%`,
      `- **Last beat:** ${simDate(p.heartbeatDay)}`,
      "",
      `## Life so far`,
      ...p.lifeEvents.map((e) => `- ${simDate(e.simDay)} — ${e.description}`),
      "",
    ].join("\n");
    await writeFile(join(dir, "heartbeat.md"), hb);

    // memory.md
    const byKind = new Map<string, typeof p.memories>();
    for (const m of p.memories) {
      const arr = byKind.get(m.kind) ?? [];
      arr.push(m);
      byKind.set(m.kind, arr);
    }
    const mem = [`# Memory — ${p.firstName} ${p.lastName}`, ""];
    for (const [kind, arr] of byKind) {
      mem.push(`## ${kind}`);
      for (const m of arr) mem.push(`- ${simDate(m.simDay)} — ${m.content}`);
      mem.push("");
    }
    await writeFile(join(dir, "memory.md"), mem.join("\n"));
  }

  console.log(`🪴 Wrote ${people.length} souls to ${OUT}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
