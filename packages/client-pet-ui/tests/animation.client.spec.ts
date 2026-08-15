// @vitest-environment jsdom
/**
 * Animation engine contract: frame sequences mirror the Codex pet semantics —
 * per-frame durations, three primary passes settling into the slowed idle
 * loop, one-shot fallback handoff, and the v2 16-direction look ring.
 */
import { describe, expect, it } from 'vitest'
import {
  backgroundPositionOf, lookFrameForVector, sequenceFor, type PetAnimationMap,
} from '../src/client/animation.ts'

/** 默认表夹具：与 host 端 defaultAnimations 输出同形。 */
function defaultAnimations(): PetAnimationMap {
  const idle = {
    frames: [0, 1, 2, 3, 4, 5].map(i => ({ spriteIndex: i, durationMs: [1680, 660, 660, 840, 840, 1920][i]! })),
    loopStart: 0 as number | null,
    fallback: 'idle',
  }
  const state = (row: number, count: number, ms: number, lastMs: number) => {
    const primary = Array.from({ length: count }, (_, c) => ({
      spriteIndex: row * 8 + c, durationMs: c === count - 1 ? lastMs : ms,
    }))
    return { frames: [...primary, ...primary, ...primary, ...idle.frames], loopStart: primary.length * 3 as number | null, fallback: 'idle' }
  }
  return {
    idle,
    'running-right': state(1, 8, 120, 220),
    'running-left': state(2, 8, 120, 220),
    waving: state(3, 4, 140, 280),
    jumping: state(4, 5, 140, 280),
    failed: state(5, 8, 140, 240),
    waiting: state(6, 6, 150, 260),
    running: state(7, 6, 120, 220),
    review: state(8, 6, 150, 280),
  }
}

const COLUMNS = 8

describe('sequenceFor', () => {
  it('maps sprite indices to grid cells row-major', () => {
    const seq = sequenceFor(defaultAnimations(), COLUMNS, 'running')
    expect(seq.frames[0]).toEqual({ columnIndex: 0, rowIndex: 7, frameDurationMs: 120 })
    expect(seq.frames[5]).toEqual({ columnIndex: 5, rowIndex: 7, frameDurationMs: 220 })
  })

  it('keeps the slowed idle loop starting at index 0', () => {
    const seq = sequenceFor(defaultAnimations(), COLUMNS, 'idle')
    expect(seq.loopStartIndex).toBe(0)
    expect(seq.frames.map(f => f.frameDurationMs)).toEqual([1680, 660, 660, 840, 840, 1920])
    expect(seq.fallback).toBe('idle')
  })

  it('settles a state sequence into the idle tail after three passes', () => {
    const seq = sequenceFor(defaultAnimations(), COLUMNS, 'waving')
    expect(seq.frames).toHaveLength(4 * 3 + 6)
    expect(seq.loopStartIndex).toBe(12)
    expect(seq.frames[12]).toEqual({ columnIndex: 0, rowIndex: 0, frameDurationMs: 1680 })
  })

  it('falls back to idle for an unknown state name', () => {
    const seq = sequenceFor(defaultAnimations(), COLUMNS, 'nonexistent')
    expect(seq.frames.map(f => f.rowIndex)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('keeps a one-shot track shape with its fallback name', () => {
    const animations = defaultAnimations()
    animations['trick'] = { frames: [{ spriteIndex: 1, durationMs: 500 }], loopStart: null, fallback: 'waving' }
    const seq = sequenceFor(animations, COLUMNS, 'trick')
    expect(seq.loopStartIndex).toBeNull()
    expect(seq.fallback).toBe('waving')
  })

  it('rejects a sprite index outside the grid', () => {
    const animations = defaultAnimations()
    animations['broken'] = { frames: [{ spriteIndex: 72, durationMs: 100 }], loopStart: 0, fallback: 'idle' }
    expect(() => sequenceFor(animations, COLUMNS, 'broken', 72)).toThrow(RangeError)
  })

  it('throws when the table lacks the required idle track', () => {
    expect(() => sequenceFor({}, COLUMNS, 'idle')).toThrow('missing the required idle track')
  })

  it('skips the bounds check when no frame count is given', () => {
    const animations = defaultAnimations()
    animations['wild'] = { frames: [{ spriteIndex: 999, durationMs: 100 }], loopStart: 0, fallback: 'idle' }
    const seq = sequenceFor(animations, COLUMNS, 'wild')
    expect(seq.frames[0]).toEqual({ columnIndex: 7, rowIndex: 124, frameDurationMs: 100 })
  })
})

describe('lookFrameForVector', () => {
  it('maps pointer vectors onto the 16-direction ring', () => {
    // 正上方 = 方向 0；正右 = 方向 4；正下 = 8；正左 = 12
    expect(lookFrameForVector(0, -100, 11)).toEqual({ columnIndex: 0, rowIndex: 9, frameDurationMs: 0 })
    expect(lookFrameForVector(100, 0, 11)).toEqual({ columnIndex: 4, rowIndex: 9, frameDurationMs: 0 })
    expect(lookFrameForVector(0, 100, 11)).toEqual({ columnIndex: 0, rowIndex: 10, frameDurationMs: 0 })
    expect(lookFrameForVector(-100, 0, 11)).toEqual({ columnIndex: 4, rowIndex: 10, frameDurationMs: 0 })
  })

  it('rounds diagonal vectors to the nearest 22.5° sector', () => {
    // 右下 45° → 方向 6（第二行第 6 列）
    expect(lookFrameForVector(100, 100, 11)).toEqual({ columnIndex: 6, rowIndex: 9, frameDurationMs: 0 })
  })

  it('returns null inside the dead zone and on v1 sheets', () => {
    expect(lookFrameForVector(0, 0, 11)).toBeNull()
    expect(lookFrameForVector(100, 100, 9)).toBeNull()
  })
})

describe('backgroundPositionOf', () => {
  it('converts cells to percentage positions over the scaled sheet', () => {
    expect(backgroundPositionOf({ columnIndex: 0, rowIndex: 0, frameDurationMs: 0 }, COLUMNS, 9)).toBe('0% 0%')
    expect(backgroundPositionOf({ columnIndex: 7, rowIndex: 8, frameDurationMs: 0 }, COLUMNS, 9)).toBe('100% 100%')
    expect(backgroundPositionOf({ columnIndex: 4, rowIndex: 4, frameDurationMs: 0 }, COLUMNS, 9)).toBe('57.14285714285714% 50%')
  })
})
