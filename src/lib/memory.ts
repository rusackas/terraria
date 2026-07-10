// Memory helpers. Reflection text itself is written by the LLM (see
// content.ts makeReflection); this module just persists memories.

import { prisma } from "./db";

export async function remember(
  personaId: string,
  day: number,
  kind: string,
  content: string,
  weight = 1,
) {
  await prisma.memory.create({
    data: { personaId, simDay: day, kind, content, weight },
  });
}
