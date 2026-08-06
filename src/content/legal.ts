/**
 * Terms, and the position on minors.
 *
 * These live in the app rather than in a markdown file under docs/ so there is
 * exactly one copy. Terms applied retroactively to work people have already
 * made cannot be cleaned up afterwards — you cannot go back and ask twelve
 * strangers whether the licence they never read may change — so the words a
 * contributor agreed to have to be the words that shipped that day, and the
 * git history of this file is that record.
 *
 * Plain English on purpose. Every clause here describes something the product
 * already does; if a clause and the product ever disagree, the product is the
 * bug. This has not been through a lawyer, and it should be before anything is
 * sold — the print line in Phase C is the moment that stops being optional.
 */

export interface Doc {
  slug: string
  title: string
  standfirst: string
  updated: string
  sections: { heading: string; paragraphs: string[] }[]
}

export const TERMS: Doc = {
  slug: 'terms',
  title: 'Terms',
  standfirst:
    'What you keep, what you grant, and what this place promises you in return.',
  updated: '2026-08-05',
  sections: [
    {
      heading: 'You keep your own work',
      paragraphs: [
        'The strokes you draw are yours. Signing up to this changes nothing about that — there is no assignment of copyright here and there never will be.',
        'A finished canvas is a collective work made of several layers by several people. Each contributor owns their own layer. Nobody owns the whole canvas alone, including us.',
      ],
    },
    {
      heading: 'What you grant, by drawing',
      paragraphs: [
        'When you submit a layer you grant Foolscap a non-exclusive, worldwide, royalty-free, perpetual licence to store it, to display it as part of the canvas it belongs to, to render it into images and timelapse video of that canvas, and to reproduce that canvas in print.',
        'The licence is perpetual because the archive is append-only. Nothing is ever deleted from it, so a licence that could be withdrawn would be a promise this product is not built to keep. What can happen instead is that a layer stops being served — see “Having your work taken down”.',
        'It is non-exclusive, so you keep every other right you have. You can post your layer anywhere you like, sell prints of it yourself, or licence it to somebody else, without asking us.',
        'You grant every other contributor to that canvas the same right to display, share and reproduce the finished canvas that their own layer is part of. Twelve people cannot each hold a veto over one picture.',
      ],
    },
    {
      heading: 'What we will not do with it',
      paragraphs: [
        'We will not sell your layer on its own, or licence it on its own to anyone else.',
        'We will not use your work to train machine-learning models, and we will not licence it to anybody else for that purpose.',
        'We will not put your work in advertising for something that is not Foolscap.',
        'If prints of finished canvases are ever sold, every contributor to that canvas will be told before it happens and will be able to decline having their layer reproduced in something sold. That is not a policy we intend to keep in good faith — it is how the feature is built: asking for a print asks everybody who drew on the canvas, nothing is made until all of them have said yes, and a single no ends it. Declining removes your layer from the printed edition; it does not remove it from the canvas or from the archive.',
      ],
    },
    {
      heading: 'What you promise',
      paragraphs: [
        'That what you draw is yours to draw. Do not trace, copy or reproduce somebody else’s work here.',
        'That you will not use a layer to attack, harass or identify a real person, and will not draw sexual content involving children, or anything unlawful.',
        'That you understand a submitted layer cannot be edited or taken back by you. Ten minutes and an ink budget are the only takes you get, on purpose.',
      ],
    },
    {
      heading: 'Having your work taken down',
      paragraphs: [
        'A layer can be hidden. Hidden means it stops being served: the canvas, its timelapse and its video all render as though that hand had not arrived. The row stays in the archive, because an append-only ledger with holes in it is not an archive.',
        'We hide a layer when it breaks the promises above, and we will hide yours on request if you have a serious reason — being unhappy with what you drew is not one, and neither is a canvas being finished.',
        'A whole canvas can be unlisted, which takes it off the gallery shelf while leaving it reachable at its own address for everyone who drew on it.',
      ],
    },
    {
      heading: 'What we collect',
      paragraphs: [
        'A random identifier stored in your browser, which is how a returning hand is recognised as the same hand. It is generated, not measured: nothing about your device, your location or you is derived from it or sent to us. You can attach more than one browser to the same mark with a recovery key, which is a random string we store only the digest of.',
        'A city, if the person who opened a canvas chose one. It belongs to the canvas and not to anybody who drew on it, it is picked from a list, and nothing here ever asks a browser where it is — there is no location permission prompt in this product because there is no code that could use one.',
        'If you turn notifications on: the address your browser gives us to send them to, and the two keys that address needs. Turning them off deletes it.',
        'Your signature and your layers, which are the product.',
        'No email address, no name, no password, no analytics, no advertising identifiers, no third-party trackers. There is no account to delete because there is no account.',
        'A classroom has a name, chosen by whoever opened it, and a code. That is the only free text anybody types into this product, it is visible only to that class, and it is not attached to a person.',
        'Clearing your browser storage loses your identity here permanently. There is no recovery, because there is nothing to recover it with.',
      ],
    },
    {
      heading: 'No promises about uptime',
      paragraphs: [
        'This is one person’s project. It is offered as it is, with no warranty, and it can go away. The archive is backed up nightly to two places precisely because that would otherwise be a hollow thing to say.',
      ],
    },
  ],
}

export const SAFETY: Doc = {
  slug: 'safety',
  title: 'Safety, and young people',
  standfirst:
    'Where the line is, why it is there, and what the product does about it rather than what it says.',
  updated: '2026-08-05',
  sections: [
    {
      heading: 'Thirteen and up',
      paragraphs: [
        'Foolscap is for people aged 13 and over. If you are younger than that, this is not for you yet — not because of anything you would do, but because a public canvas that strangers draw on is not something we can supervise for you.',
        'There is no age form, and that is deliberate. A date-of-birth box collects a piece of personal information about a child in order to turn them away, and it stops nobody. The honest position is a stated minimum age, a product that collects nothing about anyone, and moderation that works.',
        'Classrooms are the exception, and they are built rather than promised: a canvas inside a classroom is never handed to a stranger by the relay and never appears in the gallery or on the world map. Getting in takes a six-character code read out by whoever is running the class. There are still no accounts for children — no email, no name, no password — because a mark and a code is the whole of what a classroom needs.',
        'A school using the *public* canvases should still treat them as a public space, because they are one. The code is the difference.',
      ],
    },
    {
      heading: 'Why the design is the safeguarding',
      paragraphs: [
        'There is no chat, no comments, no direct messages and no text tool. There is no way to write a word to another person here, which means there is no grooming surface — the drawing is the only channel, and it is public, permanent and attributable to a mark.',
        'There are no avatars, and a profile is a page of drawings and nothing else — no bio, no follower count, no way to send anything to the person it belongs to.',
        'There is no way to state or discover where anybody is. A finished canvas can carry a city, chosen from a list by whoever opened it; it says where a picture happened, never where a person is, and it is the canvas that carries it.',
        'Nobody can remove or deface what a child draws. Additive-only is enforced in the database, not by convention.',
        'None of this is a side effect. Each absence is load-bearing, and each one is listed under “Never” in the roadmap for that reason.',
      ],
    },
    {
      heading: 'Reporting',
      paragraphs: [
        'Every canvas page and every turn has a report control. One tap, no form to fill in, nothing to write.',
        'Reports go to a queue a person reads. What we can do about one is hide the layer, unlist the canvas, or both.',
        'Sexual content involving children is reported to the relevant authorities and the account behind it is blocked from drawing again. That is not a moderation decision.',
      ],
    },
    {
      heading: 'If you are a parent or a teacher',
      paragraphs: [
        'Everything a child would see on a canvas was drawn by hand, by a stranger, and moderated after the fact rather than before. That is the honest description. It is a public sketchbook, not a walled garden.',
        'Nothing is collected that could identify a child: no email, no name, no location, no analytics.',
        'The report control is the fastest route to a person. Use it — one tap is genuinely all it takes, and a report from one device is enough to put something in front of us.',
      ],
    },
  ],
}

export const DOCS = [TERMS, SAFETY]
