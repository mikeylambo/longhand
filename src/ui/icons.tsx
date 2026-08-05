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
