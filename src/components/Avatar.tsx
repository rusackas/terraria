interface Props {
  svg: string | null;
  photo?: string | null;
  size?: number;
  alt?: string;
  ring?: boolean;
  dim?: boolean;
}

/** Renders a persona's portrait: a generated photo if one exists, otherwise the
 *  procedural SVG. Framed in a rounded circle. */
export function Avatar({ svg, photo, size = 48, alt, ring = false, dim = false }: Props) {
  const frame = "overflow-hidden rounded-full shrink-0 bg-[var(--surface-2)]";
  const style = {
    width: size,
    height: size,
    boxShadow: ring ? "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)" : undefined,
    filter: dim ? "grayscale(0.85) opacity(0.6)" : undefined,
  } as const;

  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={photo}
        alt={alt}
        width={size}
        height={size}
        loading="lazy"
        className={`${frame} object-cover`}
        style={style}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={alt}
      className={frame}
      style={style}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    >
      {!svg ? <span /> : null}
    </div>
  );
}
