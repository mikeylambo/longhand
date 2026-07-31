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
