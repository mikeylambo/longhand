import { useEffect, useState } from 'react'
import { runSelfTest, type Check } from './selftest'

/**
 * Served at `/?selftest=1`. Runs in the real browser against the real Canvas2D
 * rasteriser, because a headless stand-in would prove something about a
 * different renderer than the one players and printers see.
 *
 * `tests/replay.spec.ts` drives this page and fails the build on any drift.
 */
export function SelfTestPage() {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [ok, setOk] = useState(false)
  const [ms, setMs] = useState(0)

  useEffect(() => {
    const t = performance.now()
    const result = runSelfTest(1)
    setMs(Math.round(performance.now() - t))
    setChecks(result.checks)
    setOk(result.ok)
    // Handles for the Playwright spec.
    const w = window as unknown as Record<string, unknown>
    w.__selftest = result
    w.__selftestDone = true
  }, [])

  if (!checks) return <div className="panel center"><p className="stat">Running…</p></div>

  return (
    <div className="panel">
      <h1 data-testid="verdict">{ok ? 'Replay is exact' : 'Replay drifts'}</h1>
      <p>
        Twelve fixture layers at full canvas resolution, run at every sheet
        shape in the archive, every comparison pixel-for-pixel. {checks.length}{' '}
        checks in {ms}ms.
      </p>
      <div className="scroll">
        <table className="checks">
          <tbody>
            {checks.map((c) => (
              <tr key={c.name} className={c.pass ? 'pass' : 'fail'}>
                <td>{c.pass ? '✓' : '✗'}</td>
                <td>
                  <strong>{c.name}</strong>
                  <div className="stat">{c.detail}</div>
                </td>
                <td className="num">
                  {c.pass ? '0' : c.differing.toLocaleString()}
                  {c.total > 1 && (
                    <div className="stat">of {c.total.toLocaleString()}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
