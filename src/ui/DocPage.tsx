import type { Doc } from '../content/legal'
import { Footer } from './Footer'

/**
 * Terms and the safety position, rendered from the same module the rest of the
 * product reads. One copy, so the words somebody agreed to and the words in
 * the repository cannot drift apart.
 */
export function DocPage({ doc }: { doc: Doc }) {
  return (
    <div className="panel">
      <h1>{doc.title}</h1>
      <p>{doc.standfirst}</p>

      <div className="scroll doc">
        {doc.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ))}
        <p className="stat">Last changed {doc.updated}.</p>
      </div>

      <div className="row">
        <div className="spacer" />
        <a className="linkbtn solid" href="/">
          Take a slot
        </a>
      </div>

      <Footer gallery />
    </div>
  )
}
