// Generate photorealistic profile pictures for personas via a local image server
// (Draw Things / A1111). Sets each persona's current avatar photo, keeping older
// pics in history. When a persona already had a photo (i.e. this is an aging
// update), it also posts "updated their profile picture" to the feed.
//
// Usage:
//   npm run faces            # fill in missing photos (current avatars)
//   npm run faces -- --all   # regenerate every current avatar's photo

import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/db";
import { generateFace, imageServerUp, IMAGE_HOST } from "../src/lib/face";
import { ageOf } from "../src/lib/time";

const OUT = join(process.cwd(), "public", "faces");

async function main() {
  const all = process.argv.includes("--all");

  if (!(await imageServerUp())) {
    console.error(
      `⚠️  No image server reachable at ${IMAGE_HOST}.\n` +
        `   Start Draw Things, turn on its API server (Settings → enable the HTTP\n` +
        `   server on port 7860), and select a photorealistic model. Then re-run.`,
    );
    process.exit(1);
  }

  await mkdir(OUT, { recursive: true });
  const world = await prisma.world.findUnique({ where: { id: "world" } });
  const day = world?.currentDay ?? 0;

  const avatars = await prisma.avatar.findMany({
    where: { current: true, persona: { alive: true }, ...(all ? {} : { photo: null }) },
    include: { persona: true },
    orderBy: { simDay: "asc" },
  });

  console.log(`🎨 Generating ${avatars.length} portrait${avatars.length === 1 ? "" : "s"} via ${IMAGE_HOST}…`);
  let done = 0, failed = 0, posted = 0;

  for (const av of avatars) {
    const p = av.persona;
    const b64 = await generateFace(p.avatarSeed, {
      age: ageOf(p.birthDay, day),
      gender: p.gender,
      country: p.country,
      occupation: p.occupation,
    });
    if (!b64) {
      failed++;
      continue;
    }

    const file = `${av.id}.png`;
    await writeFile(join(OUT, file), Buffer.from(b64, "base64"));

    // Was there already a photo on an earlier avatar? Then this is an update.
    const hadPhoto = await prisma.avatar.count({
      where: { personaId: p.id, photo: { not: null }, id: { not: av.id } },
    });

    await prisma.avatar.update({ where: { id: av.id }, data: { photo: `/faces/${file}` } });

    if (hadPhoto > 0) {
      await prisma.post.create({
        data: { authorId: p.id, simDay: day, kind: "photo", text: "", image: `/faces/${file}` },
      });
      posted++;
    }

    done++;
    if (done % 5 === 0) console.log(`  …${done}/${avatars.length}`);
  }

  console.log(`✅ ${done} generated, ${failed} failed${posted ? `, ${posted} profile-pic updates posted` : ""}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
