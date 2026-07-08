// Minimal renderer for the soul markdown (headings, bullets, emphasis, rules).
// Avoids pulling in a full markdown dependency for our small, controlled format.

export function SoulView({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];

  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="list-disc pl-5 space-y-0.5 text-[0.95rem]">
          {list.map((li, i) => (
            <li key={i}>{li}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flush();
      out.push(
        <h3 key={out.length} className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)] mt-4 first:mt-0">
          {line.slice(3)}
        </h3>,
      );
    } else if (line.startsWith("# ")) {
      flush();
      out.push(
        <h2 key={out.length} className="text-lg font-semibold">
          {line.slice(2)}
        </h2>,
      );
    } else if (line.startsWith("- ")) {
      list.push(line.slice(2));
    } else if (line.startsWith("---")) {
      flush();
      out.push(<hr key={out.length} className="border-[var(--border)] my-2" />);
    } else if (line.startsWith("*") && line.endsWith("*") && line.length > 2) {
      flush();
      out.push(
        <p key={out.length} className="text-sm italic text-[var(--muted)]">
          {line.slice(1, -1)}
        </p>,
      );
    } else if (line.trim()) {
      flush();
      out.push(
        <p key={out.length} className="text-[0.95rem] leading-relaxed">
          {line}
        </p>,
      );
    }
  }
  flush();

  return <div className="space-y-1.5">{out}</div>;
}
