# Chrome Web Store assets

The files in this directory were generated from the extension's real SignalR sample flow.

| File | Dimensions | Use |
| --- | ---: | --- |
| `signalr-inspector-live.png` | 1280×800 | Primary store screenshot and README hero |
| `signalr-inspector-filtering.png` | 1280×800 | Secondary store screenshot |
| `chrome-web-store-small-promo.png` | 440×280 | Required small promotional tile |
| `chrome-web-store-marquee.png` | 1400×560 | Optional marquee promotional image |

The local screenshot harness starts the .NET application, loads the unpacked extension into
Chrome, generates hub traffic, and renders the real panel UI. That marketing-only harness is
excluded from source control; the resulting store assets remain versioned.

Do not include local production data or credentials in listing screenshots. The sample uses only
generated localhost connection tokens and fictional names.
