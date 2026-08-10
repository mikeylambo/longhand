/**
 * The first turn, taught one thing at a time.
 *
 * Not a tour. A stepped overlay on launch is the thing people dismiss without
 * reading, and it would contradict the bet this product already made: one
 * welcome screen, then straight onto a sheet. Somebody who has not drawn
 * anything yet has no questions, so answering four of them is noise.
 *
 * So each lesson waits for the moment it is *about*. The rule that nothing can
 * be erased arrives the instant the first stroke lands, when it means
 * something and cannot be argued with. What the ink meter is for arrives when
 * it has visibly moved. That the tray holds more than a pen arrives once
 * somebody has drawn enough to want another one.
 *
 * Three rules hold it together:
 *
 *   - one at a time, never stacked, longest-waiting first
 *   - the first turn only, and never again on any device that has seen them
 *   - nothing blocks, nothing needs dismissing, nothing has a Next button
 *
 * A player who ignores all of it loses nothing: every lesson is about
 * something the interface already shows.
 */

export type LessonId = 'move' | 'permanent' | 'ink' | 'tools'

/**
 * What a lesson points at.
 *
 * A hint that says "there is more than a pen in the tray" while floating in the
 * middle of the screen is asking the reader to go hunting for the tray. Each
 * lesson is about a specific thing the interface already shows, so each one is
 * drawn next to that thing with a caret aimed at it — except `sheet`, which is
 * a statement about the whole surface and points at nothing, because the whole
 * point of it is that there is no eraser to point at.
 */
export type LessonAt = 'zoom' | 'sheet' | 'meter' | 'tray'

export interface Lesson {
  id: LessonId
  text: string
  at: LessonAt
}

/**
 * Order is priority. When two conditions are true at once — and the first two
 * usually are, within a second of each other — the earlier one is taught
 * first and the other waits its turn.
 */
const LESSONS: (Lesson & { when: (s: CoachState) => boolean })[] = [
  {
    id: 'move',
    text: 'Two fingers to move and zoom',
    // Immediately: it is the only control that is not visible on screen. Aimed
    // at the zoom readout, which is the visible thing the gesture changes.
    at: 'zoom',
    when: () => true,
  },
  {
    id: 'permanent',
    text: 'Nothing here can be rubbed out — yours or anyone else’s',
    // The moment there is a mark to be permanent about. Said now it is a fact
    // about something they just did; said on arrival it is a warning about
    // nothing. Over the sheet, pointing at nothing: the absence of an eraser is
    // the whole lesson.
    at: 'sheet',
    when: (s) => s.strokes >= 1,
  },
  {
    id: 'ink',
    text: 'The pen runs out. This is all the ink this turn gets',
    // Once the meter has visibly moved, so the sentence has something to point
    // at. Before that it is a rule about an abstraction — and now it points at
    // the meter that just moved.
    at: 'meter',
    when: (s) => s.inkUsedFraction >= 0.22,
  },
  {
    id: 'tools',
    text: 'There is more than a pen in the tray',
    // Only once somebody is drawing in earnest and has not found it. Said
    // earlier it is a feature list; said here it answers a question they are
    // about to have — with a caret on the tray that holds the answer.
    at: 'tray',
    when: (s) => s.strokes >= 3 && !s.openedTools,
  },
]

export interface CoachState {
  strokes: number
  inkUsedFraction: number
  openedTools: boolean
}

const KEY = 'longhand.coached.v1'

function read(): Set<LessonId> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    const ids = JSON.parse(raw) as LessonId[]
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    // Unreadable is treated as unseen. Showing a hint twice is a much smaller
    // problem than a corrupt key stopping somebody drawing.
    return new Set()
  }
}

function write(seen: Set<LessonId>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen]))
  } catch {
    /* private mode: the lessons simply show again next time */
  }
}

export function seenLessons(): Set<LessonId> {
  return read()
}

export function coachingDone(): boolean {
  const seen = read()
  return LESSONS.every((l) => seen.has(l.id))
}

/**
 * The lesson to show now, or null.
 *
 * `seen` is passed in rather than read here so the caller can hold it for the
 * life of the turn: a lesson is marked the moment it is shown, and re-reading
 * storage on every stroke would make each one appear exactly once per render
 * rather than once per turn.
 */
export function nextLesson(state: CoachState, seen: Set<LessonId>): Lesson | null {
  for (const l of LESSONS) {
    if (seen.has(l.id)) continue
    if (l.when(state)) return { id: l.id, text: l.text, at: l.at }
    // Deliberately no `break`. If somebody draws three strokes before the ink
    // meter moves, the tools lesson should not be stuck behind the ink one.
  }
  return null
}

export function markSeen(id: LessonId, seen: Set<LessonId>): void {
  seen.add(id)
  write(seen)
}

/**
 * Ends the coaching, whatever is left of it.
 *
 * Called when a turn is submitted: somebody who has completed a whole turn has
 * learned what these say by doing them, and being taught on the second turn
 * would be the thing every app gets wrong.
 */
export function finishCoaching(): void {
  write(new Set(LESSONS.map((l) => l.id)))
}
