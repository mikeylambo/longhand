import { useState } from 'react'
import { reportContent } from '../data/ledger'
import { LEDGER_ENABLED } from '../lib/supabase'

interface Props {
  canvasId: string
  /** Null reports the whole canvas, which is what the control during a turn
   *  sends: somebody halfway through drawing can see that something is wrong
   *  without being asked to work out which of eleven hands put it there. */
  layerId?: string | null
  className?: string
  label?: string
}

/**
 * One tap, and that is the whole interaction.
 *
 * No form, no category, no text field — the drawing is the only channel this
 * product has, and a reason box would be a message box wearing another name.
 * There is nothing to confirm either: a report is cheap, reversible from the
 * operator's side, and collapses to nothing if the same browser taps twice.
 *
 * It says thank you and stays said. Reverting to "Report" after a moment would
 * invite a second tap that does nothing, and leave someone unsure whether the
 * first one landed.
 */
export function ReportButton({ canvasId, layerId = null, className, label = 'Report' }: Props) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>(
    'idle',
  )

  if (!LEDGER_ENABLED) return null

  const text = {
    idle: label,
    sending: 'Sending…',
    sent: 'Reported — thank you',
    failed: 'Did not send. Try again',
  }[state]

  return (
    <button
      className={`linkbtn tiny quiet${className ? ` ${className}` : ''}`}
      disabled={state === 'sending' || state === 'sent'}
      onClick={async () => {
        setState('sending')
        try {
          await reportContent(canvasId, layerId)
          setState('sent')
        } catch {
          setState('failed')
        }
      }}
    >
      {text}
    </button>
  )
}
