import type { JSX, SVGProps } from "react";

/**
 * The icon set, lifted from the design canvas — same 20×20 grid, same geometry,
 * same stroke width. They are stroked in `currentColor` and never carry a colour
 * of their own, which is what lets one lock glyph sit on a disabled pill in the
 * popup and on an accent callout in `apps/web` without a second copy.
 *
 * `icons.test.tsx` holds every path in here to `docs/design/*.dc.html`, so an icon
 * redrawn on the canvas and not here is a failing test rather than a slow drift.
 */
export type IconName =
  | "logo"
  | "refresh"
  | "lock"
  | "check"
  | "clock"
  | "warning"
  | "external"
  | "card"
  | "bolt"
  | "close";

type IconSpec = {
  /** The size the canvas draws it at, which is the default a caller gets. */
  size: number;
  strokeWidth: number;
  shapes: JSX.Element;
};

const ICONS: Record<IconName, IconSpec> = {
  // The brand mark: a listing going back up.
  logo: {
    size: 20,
    strokeWidth: 1.9,
    shapes: (
      <>
        <path d="M4 11.25 10 5.25l6 6" />
        <path d="M5 14.75h10" />
      </>
    ),
  },
  refresh: {
    size: 16,
    strokeWidth: 1.6,
    shapes: (
      <>
        <path d="M16 6.5A7 7 0 1 0 17 10" />
        <path d="M16.5 3.5v3.2h-3.2" />
      </>
    ),
  },
  lock: {
    size: 14,
    strokeWidth: 1.6,
    shapes: (
      <>
        <rect x="4.5" y="8.8" width="11" height="7.2" rx="1.6" />
        <path d="M7.2 8.8V6.6a2.8 2.8 0 0 1 5.6 0v2.2" />
      </>
    ),
  },
  check: {
    size: 14,
    strokeWidth: 2,
    shapes: <path d="M4.6 10.4 8.2 14l7.2-8" />,
  },
  clock: {
    size: 14,
    strokeWidth: 1.6,
    shapes: (
      <>
        <circle cx="10" cy="10" r="6.6" />
        <path d="M10 6.4V10l2.4 1.5" />
      </>
    ),
  },
  warning: {
    size: 22,
    strokeWidth: 1.6,
    shapes: (
      <>
        <path d="M10 3.6 17 16H3z" />
        <path d="M10 8.4v3" />
        <path d="M10 13.6h.01" />
      </>
    ),
  },
  external: {
    size: 13,
    strokeWidth: 1.6,
    shapes: (
      <>
        <path d="M11 4h5v5" />
        <path d="M16 4 9.2 10.8" />
        <path d="M14 12v3.2A1.8 1.8 0 0 1 12.2 17H4.8A1.8 1.8 0 0 1 3 15.2V7.8A1.8 1.8 0 0 1 4.8 6H8" />
      </>
    ),
  },
  card: {
    size: 14,
    strokeWidth: 1.6,
    shapes: (
      <>
        <rect x="3" y="5.5" width="14" height="9" rx="1.8" />
        <path d="M3 8.8h14" />
      </>
    ),
  },
  bolt: {
    size: 14,
    strokeWidth: 1.6,
    shapes: <path d="M11 2.6 4.8 11h4.4l-.6 6.4L15.4 9H11z" />,
  },
  close: {
    size: 24,
    strokeWidth: 1.8,
    shapes: <path d="M6.5 6.5l7 7M13.5 6.5l-7 7" />,
  },
};

export const iconNames = Object.keys(ICONS) as IconName[];

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: IconName;
  /** Overrides the size the canvas draws this icon at. */
  size?: number;
  /**
   * What a screen reader should call it. Left off — the usual case, since the icon
   * sits beside its own label — the icon is hidden from the accessibility tree
   * rather than announced as an unnamed graphic.
   */
  label?: string;
};

export function Icon({ name, size, label, ...rest }: IconProps): JSX.Element {
  const spec = ICONS[name];
  const px = size ?? spec.size;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={spec.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      {label ? <title>{label}</title> : null}
      {spec.shapes}
    </svg>
  );
}
