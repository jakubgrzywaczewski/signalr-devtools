# Chrome Web Store assets

The files in this directory were generated from the extension's real SignalR sample flow.

| File | Dimensions | Use |
| --- | ---: | --- |
| `signalr-inspector-live.png` | 1280×800 | Primary store screenshot and README hero |
| `signalr-inspector-filtering.png` | 1280×800 | Secondary store screenshot |
| `chrome-web-store-small-promo.png` | 440×280 | Required small promotional tile |
| `chrome-web-store-marquee.png` | 1400×560 | Optional marquee promotional image |

The local screenshot harness starts the .NET application, loads the unpacked extension into
Chrome, invokes the extension action for the sample tab, waits for the automatic reload, generates
hub traffic, and renders the real panel UI. It asserts captured traffic before writing an image.
That marketing-only harness is excluded from source control; the resulting store assets remain
versioned.

Do not include local production data or credentials in listing screenshots. The sample uses only
generated localhost connection tokens and fictional names.

## Permission justification

- `activeTab`: grants temporary access only after the developer clicks the SignalR Inspector
  toolbar icon on the tab they want to inspect. Access is revoked when that tab navigates to a
  different site or closes.
- `scripting`: dynamically registers the bundled isolated-world bridge and MAIN-world SignalR
  instrumentation for the activated tab before reloading it. No code is downloaded or executed
  remotely.

The extension does not declare `host_permissions`, `optional_host_permissions`, or static
`content_scripts` matches. Chrome Web Store privacy disclosures should describe the explicit
per-tab activation flow and must not claim broad access to every website.
