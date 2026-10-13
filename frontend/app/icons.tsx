// Authored icon set — one consistent stroke (1.6), round joins, currentColor.
// Drawn SVG, never emoji or unicode glyphs.

type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export function ShieldCheck({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3 5 6v5.5c0 4 2.9 7.3 7 8.5 4.1-1.2 7-4.5 7-8.5V6l-7-3Z" />
      <path d="m9 11.8 2.1 2.1L15.2 9.8" />
    </svg>
  );
}

export function Search({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function ArrowRight({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function Lock({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4.5" y="10" width="15" height="10" rx="2.2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
      <circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LockOpen({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4.5" y="10" width="15" height="10" rx="2.2" />
      <path d="M8 10V7.5a4 4 0 0 1 7.7-2.1" />
      <circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Download({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  );
}

export function Check({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function Pulse({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 12h4l2.5-6 4 13L16 12h5" />
    </svg>
  );
}

export function Database({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.8" />
      <path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" />
      <path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" />
    </svg>
  );
}

export function ArrowLeft({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M20 12H5" />
      <path d="m11 6-6 6 6 6" />
    </svg>
  );
}
