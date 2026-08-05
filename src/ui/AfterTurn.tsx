import { useEffect, useState } from 'react'
import { fetchPlaces, giftSlot, setCanvasPlace, type Place } from '../data/ledger'

/**
 * The two things you can only do about a canvas you have just drawn on, and
 * only on the screen where you have just drawn on it.
 *
 * Both are offered once and never nagged about. Saving a place is a gesture
 * toward one person; naming where a canvas is happens once, by whoever opened
 * it, and never again.
 */
export function AfterTurn({
  canvasId,
  slot,
}: {
  canvasId: string
  /** Naming the place is the opening hand's alone: a place the twelfth player
   *  could change is a place the first eleven never agreed to. */
  slot: number
}) {
  const [token, setToken] = useState<string | null>(null)
  const [giftSlotIndex, setGiftSlotIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [places, setPlaces] = useState<Place[] | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [openPlaces, setOpenPlaces] = useState(false)

  useEffect(() => {
    if (slot !== 1) return
    fetchPlaces().then(setPlaces).catch(() => {})
  }, [slot])

  const link = token ? `${location.origin}/g/${token}` : null

  return (
    <>
      <div className="review-caption">Save a place for somebody</div>
      {link ? (
        <>
          <p className="stat">
            Slot {giftSlotIndex} is being held. Send this to one person — the
            canvas waits for them for three days, and then the slot goes back to
            the pool.
          </p>
          <div className="keybox">{link}</div>
          <div className="row">
            <button
              className="linkbtn"
              onClick={async () => {
                try {
                  if (navigator.share) await navigator.share({ url: link })
                  else {
                    await navigator.clipboard.writeText(link)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }
                } catch {
                  /* the share sheet was dismissed */
                }
              }}
            >
              {copied ? 'Link copied' : 'Send it'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="stat">
            One place, held beside your own work, for one person. Nothing is
            gained by giving it and there is no count of how many you have.
          </p>
          <div className="row">
            <button
              className="linkbtn"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  const g = await giftSlot(canvasId)
                  setToken(g.token)
                  setGiftSlotIndex(g.slot)
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Holding a place…' : 'Hold a place for someone'}
            </button>
          </div>
        </>
      )}

      {slot === 1 && (
        <>
          <div className="review-caption">Where is this canvas?</div>
          {pinned ? (
            <p className="stat">
              Pinned to {pinned}. When it finishes it lands on the world map.
            </p>
          ) : (
            <>
              <p className="stat">
                You opened this one, so you can say where it is — a city, chosen
                from a list. It belongs to the canvas rather than to you, and
                nothing here asks your device where it is. Leave it and the
                canvas simply has no place, which is the ordinary case.
              </p>
              <div className="row">
                <button className="linkbtn quiet" onClick={() => setOpenPlaces((v) => !v)}>
                  {openPlaces ? 'Never mind' : 'Say where it is'}
                </button>
              </div>
              {openPlaces && places && (
                <div className="placegrid">
                  {places.map((p) => (
                    <button
                      key={p.id}
                      className="toolchip"
                      onClick={async () => {
                        setError(null)
                        try {
                          await setCanvasPlace(canvasId, p.id)
                          setPinned(p.name)
                          setOpenPlaces(false)
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e))
                        }
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {error && <p className="stat error">{error}</p>}
    </>
  )
}
