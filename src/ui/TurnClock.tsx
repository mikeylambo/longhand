import { useEffect, useState } from 'react'

interface Props {
  /** Epoch ms the turn runs out, or null when no clock is running. */
  expiresAt: number | null
  onExpired: () => void
}

/** Under a minute the clock stops being ambient and starts being a warning. */
const URGENT_MS = 60_000

function format(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The turn timer. The slot returns to the pool when it runs out, per the brief
 * — which means an unsubmitted drawing is lost, so the clock is shown from the
 * first second rather than sprung at the end.
 */
export function TurnClock({ expiresAt, onExpired }: Props) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (expiresAt === null) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [expiresAt])

  const left = expiresAt === null ? null : expiresAt - now
  const expired = left !== null && left <= 0

  useEffect(() => {
    if (expired) onExpired()
  }, [expired, onExpired])

  if (left === null) return null

  return (
    <span className={`clock${left <= URGENT_MS ? ' urgent' : ''}`}>
      {format(left)}
    </span>
  )
}
