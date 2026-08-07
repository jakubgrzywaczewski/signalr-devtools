# Browser store assets

The files in this directory render the shipped extension panel with fixed fictional SignalR
records. Their dimensions are compatible with both Chrome Web Store and Microsoft Edge Add-ons
listings.

| File | Dimensions | Use |
| --- | ---: | --- |
| `signalr-inspector-live.png` | 1280×800 | Primary store screenshot and README hero |
| `signalr-inspector-timeline.png` | 1280×800 | Secondary store screenshot |
| `signalr-inspector-filtering.png` | 1280×800 | Third store screenshot |
| `signalr-inspector-insights.png` | 1280×800 | Fourth store screenshot (Insights) |
| `chrome-web-store-small-promo.png` | 440×280 | Small promotional tile for either store |
| `chrome-web-store-marquee.png` | 1400×560 | Optional marquee or large promotional image |

`signalr-inspector-demo.gif` is a 1280×800 README demonstration, not a browser-store screenshot or
promotional tile.

Microsoft Edge Add-ons also accepts the 1280×800 screenshots and both promotional tile sizes.
Its listing requires a square logo of at least 128×128 and recommends 300×300. Review the current
[Edge Add-ons listing requirements](https://learn.microsoft.com/microsoft-edge/extensions/publish/publish-extension)
before each submission because store requirements can change independently.

Run `npm run demo:generate` from `signalr-inspector` to regenerate the README GIF and the four
1280×800 screenshots (including the Insights screenshot). The checked-in generator opens the shipped panel in headless Chrome or Edge,
feeds fixed fictional records through its normal runtime-port handler, and asserts that pings are
hidden and reconnect analysis is visible before writing any asset. Set `CHROME_PATH` for a browser
outside the standard install locations. GIF encoding currently requires the macOS Swift toolchain;
the PNG capture path uses the browser DevTools protocol directly.

Keep filenames and visible text browser-neutral when one asset is submitted to both catalogs.
Do not include `Chrome`, `Edge`, or either store name in shared promotional art.

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

The ready-to-paste release files map each dashboard field to its exact content, following the
tab and page order of each store's console:

- [`store/CHROME_WEB_STORE.md`](store/CHROME_WEB_STORE.md) — Chrome Web Store dashboard field map
  (Package, Store listing, Privacy, Distribution tabs);
- [`store/MICROSOFT_EDGE_ADDONS.md`](store/MICROSOFT_EDGE_ADDONS.md) — Edge Partner Center field
  map (Packages, Availability, Properties, Store listings, Submit pages);
- [`store/CHROME_PRIVACY.md`](store/CHROME_PRIVACY.md) and
  [`store/EDGE_PRIVACY.md`](store/EDGE_PRIVACY.md) for the public marketplace privacy URLs;
- [`store/RELEASE_0.12.3.md`](store/RELEASE_0.12.3.md) for the package handoff, GitHub release notes,
  and publication checklist.

## Release communication

`CHANGELOG.md` is the canonical, permanent version history. Browser stores do not import it from
the repository:

- for Chrome Web Store, upload the complete new ZIP, update any changed listing metadata, and
  submit the item for review;
- for Microsoft Edge Add-ons, upload the package separately and describe an update in **Notes for
  certification** so the reviewer knows what changed;
- certification notes are not a public user-facing changelog;
- when a public store listing should advertise an update, manually place a short **What's new**
  section in its long description and link the listing's Website or Support field to this
  repository;
- when creating a tagged GitHub release, derive its release notes from the matching
  `CHANGELOG.md` version.

Keep only the latest meaningful user-facing update in a marketplace description. A full historical
log makes the listing harder to scan and becomes stale easily. Do not show an automatic
post-update page or add a full changelog to the DevTools panel. If users later ask for in-product
discovery, prefer a small version/About link that opens the canonical changelog only after an
explicit click.

## Author and support links

Keep the publisher/developer name concise and consistent: `Jakub Grzywaczewski`. Use the GitHub
repository as the extension Website and GitHub Issues as the Support URL. The packaged
`AUTHORS.md` links the maintainer's GitHub profile. Leave `homepage_url` unset so Chrome and Edge
can link the extension-management surface to their own marketplace listing dynamically.

Personal LinkedIn links are common on an author's GitHub profile or portfolio site, but are less
useful in `AUTHORS.md` and store metadata than a source repository and a dedicated support link.
Add LinkedIn only when it is intentionally part of the maintainer's public professional identity;
do not use it as the primary bug-reporting channel.
