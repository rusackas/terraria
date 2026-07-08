import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/sim";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Advance the world one tick. Protected by TICK_SECRET.
 * - Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
 * - Manual calls may pass `?secret=` or the same bearer token.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.TICK_SECRET || process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const provided = auth?.replace("Bearer ", "") || req.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const report = await tick();
    return NextResponse.json(report);
  } catch (err) {
    console.error("[terraria] tick failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export const POST = GET;
