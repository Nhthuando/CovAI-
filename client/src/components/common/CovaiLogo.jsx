/**
 * CovAI brand mark.
 *
 * A "C" drawn as a coverage ring that is not yet closed, with a check mark
 * leaving through the opening: coverage (the ring) being completed by a
 * verified test (the check). Flat colours only, so it is safe on every page,
 * including the dashboard.
 *
 * Props:
 *  - size:    rendered width/height in px (default 32)
 *  - tile:    draw the rounded brand-colour tile behind the glyph (default true).
 *             With tile={false} the ring uses currentColor.
 */
export default function CovaiLogo({ size = 32, tile = true, className, title = "CovAI" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
    >
      {tile && <rect width="32" height="32" rx="8" fill="var(--color-primary, #6d5dfb)" />}
      <path
        d="M21.6 8.9 A9.6 9.6 0 1 0 21.6 23.1"
        stroke={tile ? "#ffffff" : "currentColor"}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M11.9 16.4 l3.1 3.1 l7.6 -8"
        stroke="#5eead4"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
