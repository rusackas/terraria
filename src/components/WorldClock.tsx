import { getWorld } from "@/lib/queries";
import { simDate } from "@/lib/time";

export async function WorldClock() {
  const world = await getWorld();
  return (
    <div className="text-right leading-tight">
      <div className="text-sm font-semibold tabular-nums">{simDate(world.currentDay)}</div>
      <div className="text-[0.68rem] text-[var(--muted)]">
        tick {world.tickCount} · day {world.currentDay}
      </div>
    </div>
  );
}
