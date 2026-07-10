// Generate the photos personas chose to attach to their posts. When a persona
// posts, the model sometimes decides a photo fits and describes it (Post.imagePrompt);
// this batch turns those descriptions into real images via the local image backend.
// Kept separate from ticks because image generation is slow.
//
// Usage:  npm run photos            # generate up to 50 pending post photos
//         npm run photos -- 200     # cap at 200

import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/db";
import { generateImage, imageReady, imageBackend } from "../src/lib/face";

const OUT = join(process.cwd(), "public", "photos");

async function main() {
  const limit = parseInt(process.argv[2] || "50", 10);

  const ready = await imageReady();
  if (!ready.ok) {
    console.error(`⚠️  ${ready.note}`);
    process.exit(1);
  }

  await mkdir(OUT, { recursive: true });
  const posts = await prisma.post.findMany({
    where: { imagePrompt: { not: null }, image: null },
    orderBy: { simDay: "desc" },
    take: limit,
  });

  console.log(`🖼  Generating ${posts.length} post photo${posts.length === 1 ? "" : "s"} via ${imageBackend()}…`);
  let done = 0, failed = 0;

  for (const p of posts) {
    const b64 = await generateImage(p.id, p.imagePrompt!);
    if (!b64) {
      failed++;
      continue;
    }
    const file = `${p.id}.png`;
    await writeFile(join(OUT, file), Buffer.from(b64, "base64"));
    await prisma.post.update({ where: { id: p.id }, data: { image: `/photos/${file}` } });
    done++;
    if (done % 3 === 0) console.log(`  …${done}/${posts.length}`);
  }

  console.log(`✅ ${done} generated, ${failed} failed.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
