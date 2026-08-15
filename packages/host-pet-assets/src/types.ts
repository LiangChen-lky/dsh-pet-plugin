/**
 * Pet asset catalog wire types: the host scan result the browser plugin
 * renders from. Mirrors the Codex pet contract (spritesheet grid, manifest
 * shape, animation resolution) so Codex-format pet directories load unchanged.
 * @module @kkkey/dsh-pet-assets/types
 */

/** Spritesheet grid geometry; the default is the Codex contract cell layout. */
export interface PetFrameSpec {
  /** Frame cell width in pixels. */
  width: number
  /** Frame cell height in pixels. */
  height: number
  /** Grid column count. */
  columns: number
  /** Grid row count. */
  rows: number
}

/** One resolved animation frame: a sprite index plus its hold time. */
export interface PetAnimationFrame {
  /** Index into the row-major frame grid (0 = top-left cell). */
  spriteIndex: number
  /** Hold duration in milliseconds. */
  durationMs: number
}

/**
 * One named animation track. loopStart null marks a one-shot sequence whose
 * completion hands off to fallback; otherwise frames[loopStart..] repeat.
 */
export interface PetAnimation {
  /** Ordered frames of the track. */
  frames: PetAnimationFrame[]
  /** Index where the looping tail starts, or null for one-shot tracks. */
  loopStart: number | null
  /** Track name a finished one-shot hands off to. */
  fallback: string
}

/** Spritesheet contract generation: 2 adds the 16-direction look ring rows. */
export type PetSpriteVersion = 1 | 2

/** One scanned, validated pet as served to the browser. */
export interface PetCatalogEntry {
  /** Stable pet id (the directory name under the pets root). */
  id: string
  /** Human-facing pet name. */
  displayName: string
  /** One-sentence pet description. */
  description: string
  /** Route-relative spritesheet URL (under the plugin's route prefix). */
  spriteUrl: string
  /** Detected spritesheet contract generation. */
  spriteVersion: PetSpriteVersion
  /** Validated grid geometry. */
  frame: PetFrameSpec
  /** Resolved animation tracks keyed by state name. */
  animations: Record<string, PetAnimation>
  /** Spritesheet modification time at scan; the client cache-busting key. */
  mtimeMs: number
}

/** The served catalog document. */
export interface PetCatalog {
  /** Catalog format version; bumps on wire-incompatible changes. */
  version: 1
  /** Scanned pets in directory order. */
  pets: PetCatalogEntry[]
}
