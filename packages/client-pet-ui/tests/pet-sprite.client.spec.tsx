// @vitest-environment jsdom
/**
 * PetSprite behavior: per-frame setTimeout playback, loop-start cycling,
 * one-shot fallback handoff, hover override, static look frames, and the
 * reduced-motion first-frame rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { PetSprite, type PetSpriteProps } from '../src/client/PetSprite.tsx'
import type { PetAnimationMap } from '../src/client/animation.ts'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** 两帧 idle + 三帧 work + 一次性 trick 的小动画表。 */
function animations(): PetAnimationMap {
  return {
    idle: {
      frames: [{ spriteIndex: 0, durationMs: 100 }, { spriteIndex: 1, durationMs: 200 }],
      loopStart: 0,
      fallback: 'idle',
    },
    work: {
      frames: [
        { spriteIndex: 8, durationMs: 50 }, { spriteIndex: 9, durationMs: 50 }, { spriteIndex: 10, durationMs: 80 },
      ],
      loopStart: null,
      fallback: 'idle',
    },
    jumping: {
      frames: [{ spriteIndex: 32, durationMs: 60 }],
      loopStart: 0,
      fallback: 'idle',
    },
  }
}

function props(over: Partial<PetSpriteProps> = {}): PetSpriteProps {
  return {
    url: '/pet-assets/sprites/chefito/spritesheet.webp?v=1',
    columns: 8,
    rows: 9,
    frameCount: 72,
    animations: animations(),
    state: 'idle',
    ...over,
  }
}

/** 当前渲染帧的定位值。 */
function position(container: HTMLElement): string {
  const el = container.querySelector('div')!
  return el.style.backgroundPosition
}

describe('PetSprite playback', () => {
  it('paints the first frame immediately and steps on frame durations', () => {
    const { container } = render(<PetSprite {...props()} />)
    expect(position(container)).toBe('0% 0%')
    act(() => { vi.advanceTimersByTime(100) })
    // 第二帧：列 1 → 1/7
    expect(position(container)).toBe('14.285714285714285% 0%')
    act(() => { vi.advanceTimersByTime(200) })
    // 循环起点 0：回到首帧
    expect(position(container)).toBe('0% 0%')
  })

  it('hands a finished one-shot off to its fallback track', () => {
    const { container } = render(<PetSprite {...props({ state: 'work' })} />)
    expect(position(container)).toBe('0% 12.5%')
    act(() => { vi.advanceTimersByTime(50 + 50 + 80) })
    // 一次性播完 → 交接 idle（首帧）
    expect(position(container)).toBe('0% 0%')
    expect(container.querySelector('div')!.dataset['dshPetState']).toBe('idle')
  })

  it('overrides the state with jumping while hovered', () => {
    const { container } = render(<PetSprite {...props({ respondToHover: true })} />)
    const el = container.querySelector('div')!
    fireEvent.pointerEnter(el)
    expect(el.dataset['dshPetState']).toBe('jumping')
    expect(position(container)).toBe('0% 50%')
    fireEvent.pointerLeave(el)
    expect(el.dataset['dshPetState']).toBe('idle')
  })

  it('pins a static look frame and suppresses playback', () => {
    const { container } = render(<PetSprite {...props({
      rows: 11,
      frameCount: 88,
      lookFrame: { columnIndex: 4, rowIndex: 9, frameDurationMs: 0 },
    })} />)
    expect(position(container)).toBe('57.14285714285714% 90%')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(position(container)).toBe('57.14285714285714% 90%')
  })

  it('renders only the first frame under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { container } = render(<PetSprite {...props()} />)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(position(container)).toBe('0% 0%')
  })

  it('parks a single-frame track without scheduling', () => {
    const single = animations()
    single['idle'] = { frames: [{ spriteIndex: 0, durationMs: 100 }], loopStart: 0, fallback: 'idle' }
    const { container } = render(<PetSprite {...props({ animations: single })} />)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(position(container)).toBe('0% 0%')
  })

  it('stops at the last frame when a one-shot falls back to itself', () => {
    const selfFallback = animations()
    selfFallback['work'] = {
      frames: [{ spriteIndex: 8, durationMs: 50 }, { spriteIndex: 9, durationMs: 80 }],
      loopStart: null,
      fallback: 'work',
    }
    const { container } = render(<PetSprite {...props({ animations: selfFallback, state: 'work' })} />)
    act(() => { vi.advanceTimersByTime(1000) })
    // 自指 fallback 不交接：停在末帧（列 1 行 1）
    expect(position(container)).toBe('14.285714285714285% 12.5%')
    expect(container.querySelector('div')!.dataset['dshPetState']).toBe('work')
  })

  it('scales the box by width and the contract cell aspect', () => {
    const { container } = render(<PetSprite {...props({ widthPx: 96 })} />)
    const el = container.querySelector('div')!
    expect(el.style.width).toBe('96px')
    expect(el.style.height).toBe('104px')
    expect(el.style.backgroundSize).toBe('800% 900%')
  })
})
