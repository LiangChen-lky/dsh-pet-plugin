# @liangchen-lky/dsh-pet-assets

English | [中文](README.zh.md)

Codex-format pet asset provider: scans a pets directory at activation, validates every manifest against the Codex pet contract (the same rules as `codex-rs/tui/src/pets/model.rs`), and serves the resolved catalog plus spritesheet bytes over two named [`dsh-host-webserver`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/host/webserver/README.md) routes. The browser companion [`dsh-client-pet-ui`](../client-pet-ui/README.md) is the only shipped consumer. Pet directories stay user-owned data outside this repository — nothing is copied in.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `petsDir` | `$DSH_HOME/pets` (or `~/.dsh/pets` when the variable is unset), falling back to `$CODEX_HOME/pets`, or `~/.codex/pets` when that variable is unset | Pets root. A leading `~` expands to the user home. An explicitly configured directory that does not exist (or is not a directory) fails composition; the default chain being absent simply serves an empty catalog. |

`routePrefix` is deliberately not configurable: the fixed prefix `/pet-assets` is the wire contract between this package and the browser plugin, and both sides must agree.

## Wire surface

- `GET /pet-assets/catalog.json` — the resolved catalog: per pet id, display name, description, route-relative sprite URL, sprite contract version (1 = 1536×1872 grid, 2 = the +2 look-ring rows), frame grid, resolved animation table, and the spritesheet mtime used as the client's cache-busting key.
- `GET /pet-assets/sprites/<id>/<file>` — spritesheet bytes with the image content type. Only the manifest-declared file is served; the relative-path equality check is also the traversal guard. Both routes answer GET/HEAD and 405 everything else.

## Manifest and animation semantics

A pet is a directory with `pet.json` (or the legacy `avatar.json`) plus its spritesheet. The manifest carries optional `id`/`displayName`/`description`/`spritesheetPath`, an optional `frame` grid override, and optional custom `animations`. Validation mirrors the Codex contract: spritesheet dimensions must be one of the two contract sizes, a frame grid must cover the sheet exactly, frame count is capped at 256, custom animations default to 8 fps with loop and idle fallback, every sprite index must exist, and every fallback must name a real track. A missing manifest animation table resolves to the default table (idle, running, running-left/right, waving, jumping, failed, waiting, review, plus the TUI aliases move_*/wave/bounce/sad), whose state tracks repeat their primary frames three times and then settle into the slowed idle loop.

## Model Experience

None: the package serves HTTP assets for human-facing UI and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; it never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **The scan is an activation-time snapshot** — adding, replacing, or repairing a pet takes effect on the next composition (restart or HMR reload), not on the next request.
- **One broken pet fails the composition** — validation is fail-loud by design (a broken manifest is a misconfiguration), so there is no per-pet error surface in the catalog today.
