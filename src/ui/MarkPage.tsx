import { useEffect, useState } from 'react'
import { renderLayers } from '../engine/render'
import { SIGNATURE_H, SIGNATURE_W } from '../config'
import {
  answerPrint,
  cachedSignatureId,
  myPrintQuestions,
  type PrintQuestion,
} from '../data/ledger'
import {
  disablePush,
  enablePush,
  looksLikeRecoveryKey,
  mintRecoveryKey,
  pushState,
  redeemRecoveryKey,
  storedRecoveryKey,
} from '../data/identity'
import { loadSignature } from '../store'
import { LEDGER_ENABLED } from '../lib/supabase'
import { Footer } from './Footer'

/**
 * Everything about your own mark, in one place: the mark itself, the key that
 * carries it to another browser, and whether this product is allowed to reach
 * you.
 *
 * The recovery field is the only text input in the product, and it is worth
 * saying why it does not break the rule. "No text tool, no chat" is about there
 * being exactly one channel between people; a credential box is not a channel.
 * Nothing typed here is stored as text, shown to anybody, or attached to a
 * drawing — it is matched against a digest and thrown away.
 */
export function MarkPage() {
  const [signature] = useState(() => loadSignature())
  const [key, setKey] = useState<string | null>(() => storedRecoveryKey())
  const [minting, setMinting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [entry, setEntry] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [push, setPush] = useState<'off' | 'on' | 'blocked' | 'unsupported' | '…'>('…')
  const [prints, setPrints] = useState<PrintQuestion[]>([])

  const signatureId = cachedSignatureId()

  useEffect(() => {
    void pushState().then(setPush)
    // There is no messaging here, so this page is the only place somebody ever
    // learns that a canvas they drew on has been asked about.
    void myPrintQuestions().then(setPrints)
  }, [])

  const src = signature
    ? renderLayers(SIGNATURE_W, SIGNATURE_H, [signature.strokes], {
        scale: 0.5,
      }).toDataURL('image/png')
    : null

  return (
    <div className="panel">
      <h1>Your mark</h1>
      <p>
        No passwords, no profiles. Just you, and the art you help create.
      </p>

      <div className="scroll">
        {src ? (
          <img className="review-art mark" src={src} alt="Your mark" />
        ) : (
          <p className="stat">
            No mark on this browser yet. Take a slot and you will be asked to
            sign — or bring one over with a key, below.
          </p>
        )}

        {signatureId && (
          <div className="row">
            <a className="linkbtn" href={`/h/${signatureId}`}>
              Everything you have drawn
            </a>
          </div>
        )}

        {/* -------------------------------------------------- the key */}
        <div className="review-caption">Protect your mark</div>
        <p className="stat">
          Your mark lives on this device, and nowhere else. Want to keep it safe,
          or carry it to a new phone? Make a key and guard it like a secret — it
          is the only way to bring your mark back if this device is lost, and the
          only way anyone else could take it.
        </p>

        {key ? (
          <>
            <div className="keybox" aria-label="Your recovery key">
              {key}
            </div>
            <div className="row">
              <button
                className="linkbtn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(key)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  } catch {
                    /* the browser refused the clipboard; it is on screen */
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy it'}
              </button>
              <button
                className="linkbtn quiet"
                disabled={minting}
                onClick={async () => {
                  setMinting(true)
                  setError(null)
                  try {
                    setKey(await mintRecoveryKey())
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e))
                  } finally {
                    setMinting(false)
                  }
                }}
              >
                {/* Minting again is also how you revoke one you regret
                    writing down somewhere. */}
                Replace it
              </button>
            </div>
          </>
        ) : (
          <div className="row">
            <button
              className="linkbtn solid"
              disabled={!signatureId || minting || !LEDGER_ENABLED}
              onClick={async () => {
                setMinting(true)
                setError(null)
                try {
                  setKey(await mintRecoveryKey())
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                } finally {
                  setMinting(false)
                }
              }}
            >
              {minting ? 'Generating…' : 'Generate my key'}
            </button>
          </div>
        )}

        {/* ----------------------------------------------- redeeming */}
        <div className="review-caption">Link a device</div>
        <p className="stat">
          Already have a key? Paste it below to bring your mark to this device.
          The old one keeps working too — a mark can live on as many devices as
          you like.
        </p>
        <div className="row">
          <input
            className="keyfield"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            placeholder="lh-00000-00000-00000-00000-00000-00000"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label="A recovery key"
          />
          <button
            className="linkbtn"
            disabled={!looksLikeRecoveryKey(entry) || redeeming || !LEDGER_ENABLED}
            onClick={async () => {
              setRedeeming(true)
              setError(null)
              try {
                await redeemRecoveryKey(entry)
                location.href = '/mark'
              } catch {
                // Almost always a mistyped key rather than anything the person
                // could otherwise act on, so the message names the likely fix
                // instead of the raw failure.
                setError('We don’t recognise this key. Double-check it and try again.')
              } finally {
                setRedeeming(false)
              }
            }}
          >
            {redeeming ? 'Linking…' : 'Link device'}
          </button>
        </div>

        {prints.filter((q) => q.answered === null).length > 0 && (
          <>
            <div className="review-caption">Somebody asked about a print</div>
            <p className="stat">
              A print of a canvas you drew on. It is only made if everybody who
              drew on it agrees, and one no is enough to stop it — saying no
              costs nothing and nobody is told who said it.
            </p>
            {prints
              .filter((q) => q.answered === null)
              .map((q) => (
                <div className="row" key={q.request}>
                  <a className="linkbtn quiet" href={`/c/${q.canvas}`}>
                    “{q.seed}”
                  </a>
                  <button
                    className="linkbtn"
                    onClick={async () => {
                      await answerPrint(q.request, true)
                      setPrints(await myPrintQuestions())
                    }}
                  >
                    Yes, print it
                  </button>
                  <button
                    className="linkbtn quiet"
                    onClick={async () => {
                      await answerPrint(q.request, false)
                      setPrints(await myPrintQuestions())
                    }}
                  >
                    No
                  </button>
                </div>
              ))}
          </>
        )}

        {/* --------------------------------------------------- push */}
        <div className="review-caption">Notifications</div>
        <p className="stat">
          We keep it simple. You will only hear from us when a canvas you are on
          gets a new hand, or when one you are on is finished. No spam, no
          streaks, no nudges to come back.
        </p>
        <div className="row">
          {push === 'unsupported' && (
            <span className="stat">
              This browser cannot do notifications, or this build has no push
              keys behind it.
            </span>
          )}
          {push === 'blocked' && (
            <span className="stat">
              Notifications are blocked for this site. Your browser&rsquo;s site
              settings is the only place that can undo that.
            </span>
          )}
          {push === 'on' && (
            <button
              className="linkbtn"
              onClick={async () => {
                await disablePush()
                setPush(await pushState())
              }}
            >
              Turn them off
            </button>
          )}
          {push === 'off' && (
            <button
              className="linkbtn solid"
              disabled={!signatureId}
              onClick={async () => {
                setError(null)
                try {
                  await enablePush()
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
                setPush(await pushState())
              }}
            >
              Turn on notifications
            </button>
          )}
        </div>

        {error && <p className="stat error">{error}</p>}

        {/* Classrooms had no way in at all — the page existed and nothing
            anywhere linked to it, so a teacher could only reach it by being
            told the URL. It sits here because a class is something a person
            sets up, and this is the page about the person. Inside the scroll
            with everything else, so it does not hold a fixed strip of a phone
            screen for something most people will never tap. */}
        <h2 className="sub">A classroom</h2>
        <p className="stat">
          Draw together, privately. Enter a code to join a shared canvas with
          friends, family, or classmates. What you make here stays here — it
          never appears in the public gallery.
        </p>
        <div className="row">
          <a className="linkbtn" href="/class">
            Open or join a classroom
          </a>
        </div>
      </div>

      <Footer wander />
    </div>
  )
}
