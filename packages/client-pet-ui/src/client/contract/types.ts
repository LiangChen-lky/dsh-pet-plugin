/**
 * Wire shapes of the pet-assets catalog plus the client-side activity model.
 * The catalog types duplicate the host package's wire contract by design:
 * cross-package symbol imports between plugins are forbidden, and the catalog
 * arrives as fetch JSON.
 */

import type { PetAnimationMap } from '../animation.ts'

/** Spritesheet grid geometry (host-validated). */
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

/** One catalog pet entry as served by the host plugin. */
export interface PetCatalogEntry {
  /** Stable pet id (directory name). */
  id: string
  /** Human-facing name. */
  displayName: string
  /** One-sentence description. */
  description: string
  /** Route-relative spritesheet URL. */
  spriteUrl: string
  /** Contract generation: 2 carries the look ring rows. */
  spriteVersion: 1 | 2
  /** Grid geometry. */
  frame: PetFrameSpec
  /** Resolved animation tracks keyed by state name. */
  animations: PetAnimationMap
  /** Spritesheet mtime at host scan; cache-busting key. */
  mtimeMs: number
}

/** The catalog document served at the fixed catalog route. */
export interface PetCatalog {
  /** Catalog format version. */
  version: 1
  /** Scanned pets. */
  pets: PetCatalogEntry[]
}

/** Activity states the overlay maps onto animation tracks. */
export type PetActivityState = 'idle' | 'running' | 'waiting' | 'failed'

/** Which user interaction blocks the session (drives the waiting copy). */
export type PetWaitingKind = 'approval' | 'plan-review' | 'question'

/**
 * Current-session activity projected for the pet — a discriminated union on
 * state so consumers never null-guard kind/error pairs.
 */
export type PetActivity =
  | {
    /** No turn running, nothing pending. */
    state: 'idle'
  }
  | {
    /** A turn is running. */
    state: 'running'
  }
  | {
    /** The session blocks on user input. */
    state: 'waiting'
    /** Which interaction kind blocks it. */
    waitingKind: PetWaitingKind
  }
  | {
    /** The latest agent error persists (cleared on the next prompt). */
    state: 'failed'
    /** The stringified error. */
    error: string
  }
