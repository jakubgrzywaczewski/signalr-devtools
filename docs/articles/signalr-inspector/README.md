# SignalR Inspector article package

Publication-ready sources reviewed on 18 August 2026 against SignalR Inspector runtime behavior
through 1.0.2 and the public 1.0.0 store release. This docs-only package is versioned as 1.0.3.

## Contents

| File | Language | Role | Approximate reading time |
| --- | --- | --- | ---: |
| `signalr-inspector-architecture.en.md` | English | Canonical engineering deep dive for Medium | 24–26 min |
| `signalr-inspector-howto.en.md` | English | Practical companion for dev.to, Medium, or the project blog | 5–6 min |
| `signalr-inspector-architecture.pl.md` | Polish | Adaptation for a Polish blog or community portal | 21–23 min |
| `signalr-inspector-howto.pl.md` | Polish | Practical Polish companion | 5 min |
| `images/` | — | One cover, four screenshots, and two animated workflows | — |
| `REPORT-PL.md` | Polish | Editorial, technical, and visual audit | — |

## Recommended publication order

1. Publish the English architecture article as the canonical deep dive.
2. Add its canonical URL to the practical article, then publish the how-to two to four days later.
3. Publish the Polish adaptations with links back to the canonical English article when useful.

Do not merge the architecture essay and the how-to. They serve different reader intents: the
first builds technical credibility; the second gets a reader from installation to a useful trace
quickly.

## Uploading the graphics

The Markdown uses relative paths so the package is self-contained. Medium and similar editors may
not import those files automatically. Upload each referenced image directly, preserve its article
position, and use the wide cover image as the story's featured image.

The PNG screenshots and both GIFs are 1280×800. The cover is 1400×560. All product data is
deterministic and fictional.

## Suggested tags

- English: `SignalR`, `.NET`, `Chrome Extensions`, `Web Development`, `Debugging`
- Polish: `SignalR`, `.NET`, `Chrome DevTools`, `debugowanie`, `WebSocket`

Before promotion, update the Chrome Web Store description noted in `REPORT-PL.md` and replace the
plain-text mention of the architecture essay in each how-to with its final canonical URL.
