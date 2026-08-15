/**
 * Pet animation engine: turns the host-resolved animation table (sprite
 * indices + per-frame durations) into grid-cell frame sequences and CSS
 * background positions. Semantics mirror the Codex pet contract: a state
 * track's primary passes hand off to the slowed idle loop at loopStart, a
 * one-shot track (loopStart null) falls through to its fallback track, and v2
 * spritesheets carry a 16-direction look ring on rows 9-10.
 */

/** 一格精灵帧：网格坐标 + 停留时长。 */
export interface SpriteFrame {
  /** 列索引（0 起）。 */
  columnIndex: number
  /** 行索引（0 起）。 */
  rowIndex: number
  /** 停留毫秒数。 */
  frameDurationMs: number
}

/** 一条待播序列：帧表 + 循环起点（null 为一次性）+ 结束后去向。 */
export interface FrameSequence {
  /** 有序帧表。 */
  frames: SpriteFrame[]
  /** 循环段起点索引；null 表示播完交接给 fallback。 */
  loopStartIndex: number | null
  /** 一次性序列播完后切换的动画名。 */
  fallback: string
}

/** host 端解析后的单帧（线格式）。 */
export interface PetAnimationFrame {
  /** 行主序精灵索引。 */
  spriteIndex: number
  /** 停留毫秒数。 */
  durationMs: number
}

/** host 端解析后的动画轨道（线格式）。 */
export interface PetAnimation {
  /** 有序帧。 */
  frames: PetAnimationFrame[]
  /** 循环起点；null 为一次性。 */
  loopStart: number | null
  /** 播完交接的动画名。 */
  fallback: string
}

/** 动画表：状态名到轨道的映射。 */
export type PetAnimationMap = Record<string, PetAnimation>

/** 注视环起始行（v2 契约第 9-10 行）。 */
const LOOK_RING_BASE_ROW = 9
/** 注视环行宽。 */
const LOOK_RING_COLUMNS = 8
/** 注视环方向数（22.5° 一扇区）。 */
const LOOK_RING_DIRECTIONS = 16
/** 注视死区半径（距中心该距离内不转头，Codex 契约值）。 */
const LOOK_DEAD_ZONE_PX = 1

/**
 * 取一个状态的播放序列；未知名回退 idle（ambient 语义）。
 * @param animations - host 解析的动画表。
 * @param columns - 帧格列数（索引换算坐标）。
 * @param state - 状态名。
 * @param frameCount - 网格总帧数（越界防护；缺省不校验上限）。
 * @returns 该状态的帧序列。
 * @throws RangeError 帧索引越界时（线格式已被 host 校验，此处为边界防线）。
 */
export function sequenceFor(
  animations: PetAnimationMap, columns: number, state: string, frameCount?: number,
): FrameSequence {
  const track = animations[state] ?? animations['idle']
  if (track === undefined) throw new Error('pet animations: missing the required idle track')
  const frames = track.frames.map((frame): SpriteFrame => {
    if (frameCount !== undefined && frame.spriteIndex >= frameCount) {
      throw new RangeError(`pet animation frame ${frame.spriteIndex} is out of range (${frameCount} frames)`)
    }
    return {
      columnIndex: frame.spriteIndex % columns,
      rowIndex: Math.floor(frame.spriteIndex / columns),
      frameDurationMs: frame.durationMs,
    }
  })
  return { frames, loopStartIndex: track.loopStart, fallback: track.fallback }
}

/**
 * 指针向量映射到 16 向注视环帧（仅 v2 精灵图；atan2 角度按 22.5° 取整）。
 * @param dx - 指针相对精灵中心的水平位移（px）。
 * @param dy - 指针相对精灵中心的垂直位移（px）。
 * @param rows - 精灵图行数；小于 11 无注视环。
 * @returns 注视帧；死区内或无注视环时为 null。
 */
export function lookFrameForVector(dx: number, dy: number, rows: number): SpriteFrame | null {
  if (rows <= LOOK_RING_BASE_ROW + 1) return null
  if (Math.hypot(dx, dy) <= LOOK_DEAD_ZONE_PX) return null
  const angle = (Math.atan2(dx, -dy) * (180 / Math.PI) + 360) % 360
  const direction = Math.round(angle / (360 / LOOK_RING_DIRECTIONS)) % LOOK_RING_DIRECTIONS
  return {
    columnIndex: direction % LOOK_RING_COLUMNS,
    rowIndex: LOOK_RING_BASE_ROW + Math.floor(direction / LOOK_RING_COLUMNS),
    frameDurationMs: 0,
  }
}

/**
 * 帧坐标转 CSS background-position：背景图按 columns×rows 百分比缩放后，
 * p% 定位对齐的是图像与容器的百分比点，c/(cols-1) 恰好露出第 c 格。
 * @param frame - 目标帧。
 * @param columns - 网格列数。
 * @param rows - 网格行数。
 * @returns background-position 值。
 */
export function backgroundPositionOf(frame: SpriteFrame, columns: number, rows: number): string {
  const x = (frame.columnIndex / (columns - 1)) * 100
  const y = (frame.rowIndex / (rows - 1)) * 100
  return `${x}% ${y}%`
}
