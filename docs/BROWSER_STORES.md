# Browser store assets

The files in this directory were generated from the extension's real SignalR sample flow.
Their dimensions are compatible with both Chrome Web Store and Microsoft Edge Add-ons listings.

| File | Dimensions | Use |
| --- | ---: | --- |
| `signalr-inspector-live.png` | 1280×800 | Primary store screenshot and README hero |
| `signalr-inspector-filtering.png` | 1280×800 | Secondary store screenshot |
| `chrome-web-store-small-promo.png` | 440×280 | Small promotional tile |
| `chrome-web-store-marquee.png` | 1400×560 | Optional marquee promotional image |

Microsoft Edge Add-ons also accepts the 1280×800 screenshots and both promotional tile sizes.
Its listing requires a square logo of at least 128×128 and recommends 300×300. Review the current
[Edge Add-ons listing requirements](https://learn.microsoft.com/microsoft-edge/extensions/publish/publish-extension)
before each submission because store requirements can change independently.

The local screenshot harness starts the .NET application, loads the unpacked extension into a
supported browser, invokes the extension action for the sample tab, waits for the automatic
reload, generates hub traffic, and renders the real panel UI. It asserts captured traffic before
writing an image. That marketing-only harness is excluded from source control; the resulting store
assets remain versioned.

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
`content_scripts` matches. Browser store privacy disclosures should describe the explicit per-tab
activation flow and must not claim broad access to every website.

## Store-specific submission

Chrome Web Store and Microsoft Edge Add-ons are separate catalogs. After making the manifest
metadata browser-neutral, submit the same reviewed extension package to each store and maintain
each listing independently. Store descriptions must accurately identify the supported browser and
must not imply that SignalR Inspector is affiliated with or endorsed by Google or Microsoft.
