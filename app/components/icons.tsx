// Authored icon set for the workspaces — one stroke weight, currentColor,
// round joins. Drawn SVG, never emoji or unicode glyphs.

type Props = { className?: string };

const svg = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function ArrowLeft({ className }: Props) {
  return (
    <svg {...svg} className={className}>
      <path d="M20 12H5" />
      <path d="m11 6-6 6 6 6" />
    </svg>
  );
}

export function Check({ className }: Props) {
  return (
    <svg {...svg} className={className} strokeWidth={1.9}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function AlertTriangle({ className }: Props) {
  return (
    <svg {...svg} className={className}>
      <path d="M10.3 3.9 2 18.3A2 2 0 0 0 3.7 21h16.6A2 2 0 0 0 22 18.3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ShieldCheck({ className }: Props) {
  return (
    <svg {...svg} className={className}>
      <path d="M12 3 5 6v5.5c0 4 2.9 7.3 7 8.5 4.1-1.2 7-4.5 7-8.5V6l-7-3Z" />
      <path d="m9 11.8 2.1 2.1L15.2 9.8" />
    </svg>
  );
}

export function Database({ className }: Props) {
  return (
    <svg {...svg} className={className}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.8" />
      <path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" />
      <path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6" />
    </svg>
  );
}

export function Download({ className }: Props) {
  return (
    <svg {...svg} className={className}>
      <path d="M12 4v11" />
      <path d="m7 10.5 5 5 5-5" />
      <path d="M5 19.5h14" />
    </svg>
  );
}

export function Search({ className }: Props) {
  return (
    <svg {...svg} className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}
