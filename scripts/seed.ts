// Genesis: create the world and seed an initial population.
// Usage: npm run seed -- [count]

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { generatePersona } from "../src/lib/generate";
import { createPersona } from "../src/lib/sim";

async function main() {
  const count = parseInt(process.argv[2] || "80", 10);
  const seed = "terraria";

  console.log(`🌱 Genesis: seeding ${count} personas...`);

  // reset world to day 0
  await prisma.world.upsert({
    where: { id: "world" },
    create: { id: "world", currentDay: 0, seed },
    update: { currentDay: 0, tickCount: 0, seed },
  });

  const day = 0;
  for (let i = 0; i < count; i++) {
    const gen = generatePersona(`${seed}:genesis:${i}`, day);
    const p = await createPersona(gen, day);
    if ((i + 1) % 10 === 0) console.log(`  …${i + 1}/${count}`);
    void p;
  }

  const pop = await prisma.persona.count();
  console.log(`✅ Seeded. Population: ${pop}. World is at day 0.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
