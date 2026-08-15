# @kkkey/dsh-client-pet-ui

English | [中文](README.zh.md)

Companion-pet feature owner: one `shell.overlay` entry rendering a Codex-contract animated pet that floats above the shell, linked to the current session's activity. Spritesheet assets arrive over [`dsh-pet-assets`](../host-pet-assets/README.md) HTTP routes; the overlay itself issues no RPC and reads sessions only through the object layer (list selection plus the staged session's conversation snapshot, projected as the `petActivity` inject hooks compartment).

## Behavior

- **Activity states** — waiting (approval / plan-review / question) outranks a persisted failure, which outranks a running turn; an idle turn is the ambient blink loop. A turn settling from running to idle flashes the review track once; the overlay greets with one waving pass when a pet first appears. Tracks follow the Codex playback contract: per-frame durations, three primary passes settling into the slowed idle loop, one-shot tracks handing off to their fallback.
- **Interactions** — hovering jumps, dragging horizontally runs left/right, and releasing with momentum tosses the pet with friction and viewport-edge bounces; the settled position persists. A click without a drag toggles the pet picker; so does the context menu. On v2 spritesheets the pet looks toward the pointer (the 16-direction ring) while idle, running, or waving.
- **Bubble** — waiting and failed states raise a dismissable notification pill above the pet (dismissal is remembered per fact; a new fact re-raises it); the review flash shows a brief done pill.
- **Reduced motion** — `prefers-reduced-motion` renders the first frame only, with no scheduling.

Styling uses tokens only; copy goes through the package's own `pet` locale namespace. The entry renders nothing when the host row is absent, the fetch fails, or the catalog is empty.

## Model Experience

None, as this package renders session state for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **The catalog is fetched once per mount** — host-side pet changes land on the next reload; the overlay never re-polls.
- **Look-ring needs a v2 sheet** — the local Codex pets are all v1, so the look behavior is covered by contract tests rather than a shipped sample.
