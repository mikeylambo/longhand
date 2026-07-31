import type { Tuning } from '../config'

interface Props {
  tuning: Tuning
  onChange: (t: Tuning) => void
}

const FIELDS: Array<[keyof Tuning, string, number, number, number]> = [
  ['inkBudget', 'ink budget', 500, 20000, 100],
  ['speedRef', 'speed → thin at', 0.4, 4, 0.05],
  ['minFactor', 'width at speed', 0.15, 1, 0.01],
  ['maxFactor', 'width at rest', 0.6, 2, 0.01],
  ['widthSmoothing', 'width chase', 0.05, 1, 0.01],
  ['posSmoothing', 'position chase', 0.15, 1, 0.01],
  ['minStepCss', 'min step (css px)', 0.2, 3, 0.1],
  ['taper', 'taper length', 0, 4, 0.1],
  ['taperFloor', 'taper floor', 0.05, 1, 0.01],
]

/**
 * The brief says the ink budget and the hand-feel constants get tuned against
 * real strangers, not guessed at a desk. `?tune=1` puts them under the thumb.
 */
export function Tuner({ tuning, onChange }: Props) {
  return (
    <div className="tuner">
      {FIELDS.map(([key, label, min, max, step]) => (
        <label key={key}>
          <span>{label}</span>
          <span>{tuning[key]}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={tuning[key]}
            onChange={(e) =>
              onChange({ ...tuning, [key]: Number(e.target.value) })
            }
          />
        </label>
      ))}
    </div>
  )
}
