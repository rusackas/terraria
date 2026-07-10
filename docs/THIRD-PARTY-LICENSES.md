# Third-Party License Audit

Terraria is distributed under the [MIT License](../LICENSE). This document records
the results of a dependency license audit performed to confirm that the project can
be redistributed permissively, free of any strong-copyleft or network-copyleft
obligations.

## Summary

The full dependency tree (production + development, including all transitive
dependencies) was audited with `license-checker-rseidelsohn`. The overwhelming
majority of packages are MIT, ISC, Apache-2.0, or BSD — all permissive and fully
compatible with MIT redistribution. **No GPL, AGPL, SSPL, EUPL, or CDDL dependencies
are present.** One transitive package carries an LGPL-3.0 license, but it is an
_optional, dynamically-loaded native binary_ that ships only as an accelerator for
Next.js image optimization and is not required to build, run, or redistribute the
app (details below).

## License types present

| License            | Count | Category                        |
| ------------------ | ----: | ------------------------------- |
| MIT                |   337 | Permissive                      |
| Apache-2.0         |    31 | Permissive                      |
| ISC                |    15 | Permissive                      |
| BSD-2-Clause       |     9 | Permissive                      |
| BSD-3-Clause       |     3 | Permissive                      |
| MPL-2.0            |     3 | Weak-copyleft (review — OK)     |
| 0BSD               |     1 | Permissive                      |
| Unlicense          |     1 | Permissive (public domain)      |
| CC0-1.0            |     1 | Permissive (public domain)      |
| Python-2.0         |     1 | Permissive                      |
| BlueOak-1.0.0      |     1 | Permissive                      |
| CC-BY-4.0          |     1 | Permissive (data, attribution)  |
| LGPL-3.0-or-later  |     1 | Copyleft — flagged (see below)  |
| UNLICENSED         |     1 | Terraria itself (now MIT)       |

Counts reflect distinct installed package versions. `UNLICENSED` is the Terraria
root package as read from a cached tree before the `"license": "MIT"` field was
added; it is not a third-party dependency.

## Copyleft / flagged

### LGPL-3.0-or-later

- **`@img/sharp-libvips-darwin-arm64`** (and its per-platform siblings
  `@img/sharp-libvips-*`) — LGPL-3.0-or-later.
  - **Why it's here:** a transitive, `optional` dependency of `sharp`, which is
    itself an `optional` dependency of `next`. These are prebuilt native binaries
    wrapping [libvips](https://github.com/libvips/libvips). Next.js uses `sharp`
    to accelerate on-demand image optimization when it is present and falls back
    gracefully when it is not.
  - **Redistribution impact:** low. LGPL permits use from permissively-licensed
    software when the LGPL component is a separately-replaceable, dynamically-linked
    library — which is exactly the case here (a standalone native module loaded at
    runtime, not statically linked into Terraria's source). Terraria does not import
    or bundle it directly, and the MIT license of the app itself is unaffected.
  - **If you want it gone entirely:** it is not required. You can (a) rely on
    Next.js's built-in fallback / configure `images.unoptimized = true` in
    `next.config.ts` so no native image library is needed, or (b) if you ever add
    image processing of your own, prefer a permissively-licensed library such as
    `@resvg/resvg-js` (MPL-2.0) or `jimp` (MIT, pure-JS). No action is required for
    MIT redistribution.

### MPL-2.0 (weak-copyleft — review, no action needed)

- **`axe-core`** (transitive, accessibility testing) and **`lightningcss`** +
  **`lightningcss-darwin-arm64`** (transitive via `tailwindcss` v4).
  MPL-2.0 is file-level weak copyleft: it only requires that modifications to the
  MPL-licensed files themselves be shared. It imposes no obligations on Terraria's
  own MIT-licensed code and is standard, widely-accepted in MIT/Apache projects.
  No replacement necessary.

### CC-BY-4.0 (data — attribution)

- **`caniuse-lite`** (transitive via `browserslist`). This is a browser-support
  _data_ set, not code, licensed CC-BY-4.0 (attribution). It is not copyleft and
  imposes no source-sharing obligation. No action needed.

## Conclusion

Terraria can be redistributed under the MIT License. No GPL / AGPL / SSPL / EUPL /
CDDL dependencies exist. The single LGPL item is an optional, replaceable native
binary that does not compromise permissive redistribution, and the MPL-2.0 items
are weak-copyleft and standard. The project is clear for permissive MIT release.

---

_Audit command:_ `npx license-checker-rseidelsohn --summary` (and `--json` for
per-package detail). Re-run after dependency changes to keep this document current.
