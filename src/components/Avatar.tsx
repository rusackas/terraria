interface Props {
  svg: string | null;
  size?: number;
  alt?: string;
  ring?: boolean;
  dim?: boolean;
}

/** Renders a stored SVG portrait inside a rounded frame. */
export function Avatar({ svg, size = 48, alt, ring = false, dim = false }: Props) {
  return (
    <div
      role="img"
      aria-label={alt}
      className="overflow-hidden rounded-full shrink-0 bg-[var(--surface-2)]"
      style={{
        width: size,
        height: size,
        boxShadow: ring ? "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)" : undefined,
        filter: dim ? "grayscale(0.85) opacity(0.6)" : undefined,
      }}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    >
      {!svg ? <span /> : null}
    </div>
  );
}
