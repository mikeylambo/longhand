import { useEffect, useState } from 'react'
import {
  cachedSignatureId,
  claimClassroomTurn,
  myClassrooms,
  openClassroom,
  openClassroomCanvas,
  type Classroom,
} from '../data/ledger'
import { LEDGER_ENABLED } from '../lib/supabase'
import { Footer } from './Footer'

/**
 * Classrooms.
 *
 * Where the idea came from, and the one place the product behaves differently:
 * a class canvas is never handed to a stranger by the relay and never appears
 * in the gallery. Getting in takes a code the teacher reads out.
 *
 * There are still no accounts for children. No email, no name, no password,
 * nothing collected that could identify anybody — a mark and a six-character
 * code is the whole of it, which is exactly what makes this usable in a school
 * rather than a procurement exercise.
 */
export function ClassPage() {
  const [rooms, setRooms] = useState<Classroom[] | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signed = Boolean(cachedSignatureId())

  const refresh = () => myClassrooms().then(setRooms).catch(() => setRooms([]))

  useEffect(() => {
    if (!LEDGER_ENABLED) {
      setError('This build has no ledger, so classrooms are not available.')
      return
    }
    void refresh()
  }, [])

  return (
    <div className="panel">
      <h1>Classrooms</h1>
      <p>
        A canvas only your class can reach. Strangers are never sent to it and
        it never appears in the gallery — it is reachable at its own address by
        whoever you share it with, and nothing else.
      </p>

      <div className="scroll">
        {error && <p className="stat error">{error}</p>}

        {!signed && (
          <p className="stat">
            You need a mark first. <a href="/">Take a slot</a> and sign, then
            come back — the same mark holds your rooms.
          </p>
        )}

        <div className="review-caption">Joining a class</div>
        <p className="stat">
          The code is six characters, read out by whoever is running the class.
        </p>
        <div className="row">
          <input
            className="keyfield"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
            placeholder="ABC234"
            spellCheck={false}
            autoCapitalize="characters"
            autoComplete="off"
            aria-label="A class code"
          />
          <button
            className="linkbtn solid"
            disabled={code.length !== 6 || busy || !signed}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await claimClassroomTurn(code)
                // Straight onto the sheet: the relay knows which turn is held,
                // so the ordinary drawing screen picks it up on load.
                location.href = '/'
              } catch (e) {
                // Name the fix, not the raised error. The two the join actually
                // hits are a wrong code and a class whose canvases are all busy.
                const msg = e instanceof Error ? e.message : ''
                setError(
                  /free place|free slot/i.test(msg)
                    ? 'Every canvas in this class is busy right now — hold tight, a place will open up.'
                    : 'No canvas found under this code. Double-check it and try again.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            Join
          </button>
        </div>

        <div className="review-caption">Running one</div>
        {rooms && rooms.length > 0 && (
          <div className="rooms">
            {rooms.map((r) => (
              <div className="room" key={r.id}>
                <div className="room-head">
                  <strong>{r.name}</strong>
                  <span className="keybox inline">{r.code}</span>
                </div>
                <p className="stat">
                  {r.canvases.length === 0
                    ? 'No canvas started yet.'
                    : r.canvases
                        .map((c) => `“${c.seed}” ${c.filled}/${c.slots}`)
                        .join(' · ')}
                </p>
                <div className="row">
                  {[12, 24, 100].map((slots) => (
                    <button
                      key={slots}
                      className="linkbtn quiet"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        setError(null)
                        try {
                          await openClassroomCanvas(r.code, slots)
                          await refresh()
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e))
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      Start a {slots}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="stat">
          A room is held by your mark rather than by an account, so keep a
          recovery key from <a href="/mark">your mark</a> — that is what carries
          your rooms to a new laptop.
        </p>
        <div className="row">
          <input
            className="keyfield"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            placeholder="Year 5, Tuesday"
            aria-label="What to call the room"
          />
          <button
            className="linkbtn"
            disabled={name.trim().length === 0 || busy || !signed}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await openClassroom(name.trim())
                setName('')
                await refresh()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Open a room
          </button>
        </div>
      </div>

      <div className="row">
        <div className="spacer" />
        <a className="linkbtn solid" href="/">
          Take a slot
        </a>
      </div>

      <Footer wander />
    </div>
  )
}
