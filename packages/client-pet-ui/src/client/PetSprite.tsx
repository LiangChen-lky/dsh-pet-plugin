import { useEffect, useRef, useState } from 'react'
import {
  backgroundPositionOf, sequenceFor,
  type PetAnimationMap, type SpriteFrame,
} from './animation.ts'

/** PetSprite props: everything the renderer needs, no framework seats. */
export interface PetSpriteProps {
  /** Spritesheet URL (cache-busted by the caller). */
  url: string
  /** Grid column count. */
  columns: number
  /** Grid row count. */
  rows: number
  /** Total grid frames (bounds-checks track indices). */
  frameCount: number
  /** Host-resolved animation table. */
  animations: PetAnimationMap
  /** Requested state (animation track name). */
  state: string
  /** Static look-ring frame; suppresses playback while set. */
  lookFrame?: SpriteFrame | null
  /** Hover overrides the state with the jumping track. */
  respondToHover?: boolean
  /** Render width in px; the height follows the cell aspect ratio. */
  widthPx?: number
}

/** 契约单元格宽高比（高/宽）。 */
const CELL_ASPECT = 208 / 192
/** 默认渲染宽度（Codex 的 7.04rem 契约）。 */
const DEFAULT_WIDTH_PX = 112
/** 一次性交接链的防环上限。 */
const MAX_HANDOFF_HOPS = 8

/**
 * Render one animated pet sprite: background-position steps through the
 * host-resolved frame table on a per-frame setTimeout chain.
 * @param props - spritesheet source, requested state, and interaction flags.
 * @returns the sprite element.
 */
export function PetSprite(props: PetSpriteProps): React.JSX.Element {
  const {
    url, columns, rows, frameCount, animations, state,
    lookFrame = null, respondToHover = false, widthPx = DEFAULT_WIDTH_PX,
  } = props
  const ref = useRef<HTMLDivElement | null>(null)
  const [hovered, setHovered] = useState(false)
  const [handoff, setHandoff] = useState<string | null>(null)
  const [handoffHops, setHandoffHops] = useState(0)
  const [reducedMotion] = useState(() =>
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  const requested = respondToHover && hovered ? 'jumping' : state
  const effective = handoff ?? requested

  // 请求状态变化时放弃交接链，回到新状态
  useEffect(() => {
    setHandoff(null)
    setHandoffHops(0)
  }, [requested])

  useEffect(() => {
    const el = ref.current
    /* v8 ignore next 2 -- React 在 effect 运行前挂好 ref，该守卫只是类型防线 */
    if (el === null) return
    el.style.backgroundImage = 'url(' + url + ')'
    el.style.backgroundSize = String(columns * 100) + '% ' + String(rows * 100) + '%'
    if (lookFrame != null) {
      el.style.backgroundPosition = backgroundPositionOf(lookFrame, columns, rows)
      return
    }
    const sequence = sequenceFor(animations, columns, effective, frameCount)
    let index = 0
    let timer: number | null = null
    const paint = (): void => {
      const frame = sequence.frames[index]
      /* v8 ignore next 2 -- index 按构造恒在 frames 界内，守卫服务于 noUncheckedIndexedAccess */
      if (frame) el.style.backgroundPosition = backgroundPositionOf(frame, columns, rows)
    }
    paint()
    if (sequence.frames.length <= 1 || reducedMotion) return
    const step = (): void => {
      const frame = sequence.frames[index]
      /* v8 ignore next 2 -- index 按构造恒在 frames 界内，守卫服务于 noUncheckedIndexedAccess */
      if (!frame) return
      timer = window.setTimeout(() => {
        const next = index + 1
        if (next >= sequence.frames.length) {
          if (sequence.loopStartIndex !== null) {
            index = sequence.loopStartIndex
            paint()
            step()
            return
          }
          timer = null
          if (sequence.fallback !== effective && handoffHops < MAX_HANDOFF_HOPS) {
            setHandoff(sequence.fallback)
            setHandoffHops(handoffHops + 1)
          }
          return
        }
        index = next
        paint()
        step()
      }, frame.frameDurationMs)
    }
    step()
    return () => {
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [url, columns, rows, frameCount, animations, effective, lookFrame, reducedMotion, handoffHops])

  return (
    <div
      ref={ref}
      role="img"
      aria-hidden="true"
      data-dsh-pet-state={effective}
      onPointerEnter={respondToHover ? () => { setHovered(true) } : undefined}
      onPointerLeave={respondToHover ? () => { setHovered(false) } : undefined}
      style={{
        width: widthPx,
        height: Math.round(widthPx * CELL_ASPECT),
        imageRendering: 'pixelated',
        backgroundRepeat: 'no-repeat',
      }}
    />
  )
}
