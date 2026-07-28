# Browser store assets

The files in this directory were generated from the extension's real SignalR sample flow.
Their dimensions are compatible with both Chrome Web Store and Microsoft Edge Add-ons listings.

| File | Dimensions | Use |
| --- | ---: | --- |
| `signalr-inspector-live.png` | 1280×800 | Primary store screenshot and README hero |
| `signalr-inspector-filtering.png` | 1280×800 | Secondary store screenshot |
| `store-small-promo.png` | 440×280 | Small promotional tile for either store |
| `store-marquee.png` | 1400×560 | Optional marquee or large promotional image |

Microsoft Edge Add-ons also accepts the 1280×800 screenshots and both promotional tile sizes.
Its listing requires a square logo of at least 128×128 and recommends 300×300. Review the current
[Edge Add-ons listing requirements](https://learn.microsoft.com/microsoft-edge/extensions/publish/publish-extension)
before each submission because store requirements can change independently.

The local screenshot harness starts the .NET application, loads the unpacked extension into a
supported browser, invokes the extension action for the sample tab, waits for the automatic
reload, generates hub traffic, and renders the real panel UI. It asserts captured traffic before
writing an image. That marketing-only harness is excluded from source control; the resulting store
assets remain versioned.

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

### Public marketplace copy for 0.7

```text
What's new in 0.7

- Decode ASP.NET Core SignalR MessagePack invocations, streams, completions, and control messages.
- Keep the original Base64 beside readable decoded fields for low-level verification.
- Fall back safely for malformed, incomplete, deeply nested, or oversized binary values.
- Preserve your scroll position while reading older traffic and clear logs without stale rows.

Full changelog:
https://github.com/jakubgrzywaczewski/signalr-devtools/blob/main/CHANGELOG.md
```

### Certification notes for the 0.7.0 package

```text
This feature release adds local, dependency-free decoding of standard ASP.NET Core SignalR
MessagePack frames. It supports message types 1-9, bounded nesting and element counts, safe 64-bit
integer display, binary previews, timestamp extensions, multi-frame VarInt payloads, and graceful
fallback for malformed or truncated input.

Test steps:
1. Open a SignalR application configured with the MessagePack hub protocol.
2. Open DevTools, select SignalR Inspector, and activate the toolbar action.
3. Send a hub invocation and verify its type, target, arguments, and original Base64 in Details.

No new permissions, remote code, analytics, telemetry, or external data transmission were added.
```

## Author and support links

Keep the publisher/developer name concise and consistent: `Jakub Grzywaczewski`. Use the GitHub
repository as the extension Website and GitHub Issues as the Support URL. The packaged
`AUTHORS.md` links the maintainer's GitHub profile, and `homepage_url` points to the repository.

Personal LinkedIn links are common on an author's GitHub profile or portfolio site, but are less
useful in `AUTHORS.md` and store metadata than a source repository and a dedicated support link.
Add LinkedIn only when it is intentionally part of the maintainer's public professional identity;
do not use it as the primary bug-reporting channel.
