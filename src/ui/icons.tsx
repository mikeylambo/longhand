const base = {
  width: 19,
  height: 19,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const UndoIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M4 9h10a5 5 0 0 1 0 10h-4" />
    <path d="M8 5 4 9l4 4" />
  </svg>
)

/** Undo, mirrored. Deliberately the same arrow rather than a different one:
 *  the pair reads as one control with two directions. */
export const RedoIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M20 9H10a5 5 0 0 0 0 10h4" />
    <path d="M16 5l4 4-4 4" />
  </svg>
)

export const FitIcon = () => (
  <svg {...base} aria-hidden>
    <path d="M4 9V5h4" />
    <path d="M20 9V5h-4" />
    <path d="M4 15v4h4" />
    <path d="M20 15v4h-4" />
  </svg>
)

/** The other tools. A nib and a scatter of marks — not a hamburger, and not a
 *  wrench: everything behind it makes marks. */
export const ToolsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20 L11 13" />
    <path d="M10.5 12.5 L14 9 L15 10 L11.5 13.5 Z" />
    <circle cx="17.5" cy="6.5" r="1" />
    <circle cx="20" cy="10" r="1" />
    <circle cx="14" cy="4" r="1" />
  </svg>
)

/* ------------------------------------------------------------------ tabs */

/* Slightly larger than the tool icons and drawn on the same 24 grid, so the
   bar reads as its own row of controls rather than as tools that wandered
   down there. One idea each, no detail that dies at 22px. */
const tab = { ...base, width: 22, height: 22 }

/** A nib. The thing you came to do. */
export const DrawTabIcon = () => (
  <svg {...tab} aria-hidden>
    <path d="M4 20c1.2-4.6 3-8.2 5.4-10.9C11.8 6.4 14.2 4.9 16.6 4.5" />
    <path d="M16.6 4.5 20 8l-3.1 1.2-1.4-2.9z" />
    <path d="M6.6 15.2c1.9.2 3.3 1 4.2 2.4" />
  </svg>
)

/** Framed work on a wall. */
export const GalleryTabIcon = () => (
  <svg {...tab} aria-hidden>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.6" />
    <path d="M3.5 15.5 8.7 11l3.5 3 3-2.3 5.3 4" />
    <circle cx="9" cy="8.6" r="1.25" />
  </svg>
)

/** A globe, meridian and equator only. */
export const WorldTabIcon = () => (
  <svg {...tab} aria-hidden>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M3.8 12h16.4" />
    <path d="M12 3.8c2.1 2.3 3.2 5 3.2 8.2s-1.1 5.9-3.2 8.2c-2.1-2.3-3.2-5-3.2-8.2S9.9 6.1 12 3.8z" />
  </svg>
)

/** A signed line — your mark, not a person icon. Nobody here has a face. */
export const MarkTabIcon = () => (
  <svg {...tab} aria-hidden>
    <path d="M4 15.5c2.3-.3 3.6-1.6 4.6-4.2 1-2.7 1.7-3.9 2.5-3.9.9 0 1 1.2 1 3.4 0 2.1.4 3.1 1.3 3.1 1 0 1.8-1 2.9-3" />
    <path d="M4.5 19.2h15" />
  </svg>
)
