/**
 * Pets-directory scan and manifest validation. The semantics mirror the Codex
 * pet contract (codex-rs/tui/src/pets/model.rs) so Codex-format pet
 * directories load unchanged: default 192x208 grid, exact-cover rule,
 * 256-frame cap, animation resolution with fps/loop/fallback defaults, and
 * spritesheet paths contained inside the pet directory. Animations resolve at
 * scan time so the browser plugin renders plain frame tables.
 */
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { imageSizeFromHeader } from './image-size.ts'
import type { PetAnimation, PetAnimationFrame, PetFrameSpec, PetSpriteVersion } from './types.ts'

/** 契约允许的两种精灵图尺寸：v1 无注视环，v2 多两行 16 向注视帧。 */
const CONTRACT_SIZES = [
  { width: 1536, height: 1872, version: 1 as PetSpriteVersion },
  { width: 1536, height: 2288, version: 2 as PetSpriteVersion },
]

/** 契约帧数上限（model.rs MAX_PET_FRAMES）。 */
const MAX_PET_FRAMES = 256
/** 自定义动画 fps 上限（model.rs MAX_ANIMATION_FPS）。 */
const MAX_ANIMATION_FPS = 60
/** 自定义动画缺省 fps（model.rs: None => 8.0）。 */
const DEFAULT_ANIMATION_FPS = 8
/** 默认帧格宽（列数由图宽推出，v1/v2 均为 8）。 */
const DEFAULT_FRAME_WIDTH = 192
/** 默认帧格高（行数由图高推出，v1 为 9、v2 为 11）。 */
const DEFAULT_FRAME_HEIGHT = 208
/** idle 环境播放的整体减速倍率（前端 x6 慢速循环）。 */
const IDLE_SLOWDOWN = 6

/** 扫描产出的一只宠物（spriteUrl 由路由层拼接，这里保留文件事实）。 */
export interface ScannedPet {
  /** 稳定 id（宠物目录名，也是资源 URL 的一部分）。 */
  id: string
  /** 展示名：displayName → 清单 id → 目录名。 */
  displayName: string
  /** 一句话描述。 */
  description: string
  /** 契约代际（按精灵图尺寸判定）。 */
  spriteVersion: PetSpriteVersion
  /** 校验后的帧格几何。 */
  frame: PetFrameSpec
  /** 解析后的动画表（含默认表与清单覆盖）。 */
  animations: Record<string, PetAnimation>
  /** 扫描时的精灵图修改时间（客户端缓存破坏键）。 */
  mtimeMs: number
  /** 精灵图文件名（宠物目录内的相对名）。 */
  spriteFileName: string
  /** 精灵图绝对路径（路由层服务字节时读取）。 */
  spriteFilePath: string
}

/** pet.json / avatar.json 的原始形状（全部字段可缺省）。 */
interface PetFile {
  id?: string
  displayName?: string
  description?: string
  spritesheetPath?: string
  frame?: PetFrameSpec
  animations?: Record<string, AnimationSpec>
}

/** 清单中一条自定义动画的原始形状。 */
interface AnimationSpec {
  frames?: number[]
  fps?: number
  loop?: boolean
  fallback?: string
}

/** idle 基础帧（行 0 的 6 帧，逐帧时长为契约值）。 */
const IDLE_BASE: readonly (readonly [number, number])[] = [[0, 280], [1, 110], [2, 110], [3, 140], [4, 140], [5, 320]]

/** 生成环境 idle 动画：基础时长整体放慢后的无限循环。 */
function idleAnimation(): PetAnimation {
  return {
    frames: IDLE_BASE.map(([spriteIndex, ms]) => ({ spriteIndex, durationMs: ms * IDLE_SLOWDOWN })),
    loopStart: 0,
    fallback: 'idle',
  }
}

/**
 * 生成一个状态行动画：主序列连播 3 遍后接 idle 段并沉入待机循环
 * （model.rs app_state_animation）。行号按契约 8 列网格换算起始索引。
 */
function stateAnimation(rowIndex: number, frameCount: number, frameMs: number, finalFrameMs: number): PetAnimation {
  const primary: PetAnimationFrame[] = []
  for (let column = 0; column < frameCount; column++) {
    primary.push({
      spriteIndex: rowIndex * 8 + column,
      durationMs: column === frameCount - 1 ? finalFrameMs : frameMs,
    })
  }
  const idle = idleAnimation()
  return {
    frames: [...primary, ...primary, ...primary, ...idle.frames],
    loopStart: primary.length * 3,
    fallback: 'idle',
  }
}

/** 默认动画表：应用态命名 + TUI 别名（model.rs default_animations）。 */
function defaultAnimations(): Record<string, PetAnimation> {
  const table: [string, PetAnimation][] = [
    ['idle', idleAnimation()],
    ['running-right', stateAnimation(1, 8, 120, 220)],
    ['running-left', stateAnimation(2, 8, 120, 220)],
    ['waving', stateAnimation(3, 4, 140, 280)],
    ['jumping', stateAnimation(4, 5, 140, 280)],
    ['failed', stateAnimation(5, 8, 140, 240)],
    ['waiting', stateAnimation(6, 6, 150, 260)],
    ['running', stateAnimation(7, 6, 120, 220)],
    ['review', stateAnimation(8, 6, 150, 280)],
    ['move_right', stateAnimation(1, 8, 120, 220)],
    ['move_left', stateAnimation(2, 8, 120, 220)],
    ['wave', stateAnimation(3, 4, 140, 280)],
    ['bounce', stateAnimation(4, 5, 140, 280)],
    ['sad', stateAnimation(5, 8, 140, 240)],
  ]
  return Object.fromEntries(table)
}

/** 校验整张动画表：帧索引不越界、fallback 指向存在的动画（model.rs validate_animation_indices）。 */
function validateAnimations(animations: Record<string, PetAnimation>, frameCount: number, fail: (message: string) => never): void {
  for (const [name, animation] of Object.entries(animations)) {
    /* v8 ignore next 2 -- 清单动画在插入前已拦截空帧，默认表帧数恒定非空（上游 model.rs 的双重检查） */
    if (animation.frames.length === 0) fail(`animation ${name} must include at least one frame`)
    for (const frame of animation.frames) {
      if (frame.spriteIndex >= frameCount) {
        fail(`animation ${name} references sprite index ${frame.spriteIndex}, but pet has ${frameCount} frames`)
      }
    }
    if (!(animation.fallback in animations)) {
      fail(`animation ${name} fallback ${animation.fallback} does not exist`)
    }
  }
}

/**
 * 合并清单自定义动画到默认表（model.rs load_animations）：
 * fps 默认 8、loop 默认 true、fallback 默认 idle。
 */
function resolveAnimations(
  specs: Record<string, AnimationSpec> | undefined, frameCount: number, fail: (message: string) => never,
): Record<string, PetAnimation> {
  const animations = defaultAnimations()
  for (const [name, spec] of Object.entries(specs ?? {})) {
    const frames = spec.frames ?? []
    if (frames.length === 0) fail(`animation ${name} must include at least one frame`)
    for (const spriteIndex of frames) {
      if (spriteIndex >= frameCount) {
        fail(`animation ${name} references sprite index ${spriteIndex}, but pet has ${frameCount} frames`)
      }
    }
    const fps = spec.fps ?? DEFAULT_ANIMATION_FPS
    if (!Number.isFinite(fps) || fps <= 0 || fps > MAX_ANIMATION_FPS) {
      fail(`animation ${name} fps must be finite and between 0 and ${MAX_ANIMATION_FPS}, got ${String(spec.fps)}`)
    }
    animations[name] = {
      frames: frames.map(spriteIndex => ({ spriteIndex, durationMs: 1000 / fps })),
      loopStart: (spec.loop ?? true) ? 0 : null,
      fallback: spec.fallback === undefined || spec.fallback === '' ? 'idle' : spec.fallback,
    }
  }
  validateAnimations(animations, frameCount, fail)
  return animations
}

/** 探测精灵图尺寸与修改时间；文件不可读经 fail 发散（契约错误带宠物上下文）。 */
async function probeSprite(
  spriteFilePath: string,
  fail: (message: string) => never,
): Promise<{ size: { width: number; height: number }; mtimeMs: number }> {
  let header: Uint8Array
  let mtimeMs: number
  try {
    const handle = await open(spriteFilePath, 'r')
    try {
      header = new Uint8Array(64)
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      header = header.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
    mtimeMs = (await stat(spriteFilePath)).mtimeMs
  } catch {
    fail(`missing spritesheet ${spriteFilePath}`)
  }
  // 格式错误不是缺失：带 read 上下文透出（上游 image_dimensions 同款语义）
  try {
    return { size: imageSizeFromHeader(header), mtimeMs }
  } catch (error) {
    fail(`read ${spriteFilePath}: ${(error as Error).message}`)
  }
}

/** 加载并校验一只宠物目录（pet.json 优先，legacy avatar.json 兜底）。 */
async function loadPet(petsDir: string, dirName: string): Promise<ScannedPet | null> {
  const petDir = join(petsDir, dirName)
  const manifestFile = await manifestOf(petDir)
  if (manifestFile === null) return null
  const fail = (message: string): never => {
    throw new Error(`pet "${dirName}": ${message}`)
  }

  const file = await parseManifest(petDir, manifestFile, fail)

  // 路径收容：spritesheetPath 只允许目录内相对子路径，拒绝绝对路径与 .. 逃逸
  const spriteFileName = file.spritesheetPath?.trim() ?? ''
  const spriteRelative = spriteFileName === '' ? 'spritesheet.webp' : spriteFileName
  if (isAbsolute(spriteRelative) || spriteRelative.split(/[\\/]/).includes('..')) {
    fail(`spritesheet path must stay inside ${petDir}`)
  }
  const spriteFilePath = resolve(petDir, spriteRelative)

  const { size, mtimeMs } = await probeSprite(spriteFilePath, fail)

  const contract = CONTRACT_SIZES.find(c => c.width === size.width && c.height === size.height)
  // return 形式让 never 发散参与控制流窄化，下方 contract 即为已定义
  if (contract === undefined) {
    return fail(`spritesheet must be 1536x1872 or 1536x2288 pixels, got ${size.width}x${size.height}`)
  }

  // 帧格：清单可显式覆盖；默认按契约单元格从图尺寸推出（v1 8x9、v2 8x11）
  const frame = file.frame ?? {
    width: DEFAULT_FRAME_WIDTH,
    height: DEFAULT_FRAME_HEIGHT,
    columns: size.width / DEFAULT_FRAME_WIDTH,
    rows: size.height / DEFAULT_FRAME_HEIGHT,
  }
  if (frame.width === 0 || frame.height === 0 || frame.columns === 0 || frame.rows === 0) {
    fail('pet frame dimensions and grid counts must be non-zero')
  }
  const totalWidth = frame.width * frame.columns
  const totalHeight = frame.height * frame.rows
  if (totalWidth !== size.width || totalHeight !== size.height) {
    fail(`pet frame grid must cover spritesheet exactly: expected ${size.width}x${size.height}, got ${totalWidth}x${totalHeight}`)
  }
  const frameCount = frame.columns * frame.rows
  if (frameCount > MAX_PET_FRAMES) {
    fail(`pet frame count ${frameCount} exceeds maximum ${MAX_PET_FRAMES}`)
  }

  const manifestId = file.id?.trim() ?? ''
  const displayName = file.displayName?.trim() ?? ''
  return {
    id: dirName,
    displayName: displayName !== '' ? displayName : manifestId !== '' ? manifestId : dirName,
    description: file.description?.trim() ?? '',
    spriteVersion: contract.version,
    frame,
    animations: resolveAnimations(file.animations, frameCount, fail),
    mtimeMs,
    spriteFileName: spriteRelative,
    spriteFilePath,
  }
}

/** 读取并解析清单文件；解析失败经 fail 发散（带上宠物上下文的错误）。 */
async function parseManifest(petDir: string, manifestFile: string, fail: (message: string) => never): Promise<PetFile> {
  try {
    return JSON.parse(await readFile(join(petDir, manifestFile), 'utf8')) as PetFile
  } catch (error) {
    // readFile/JSON.parse 抛出的总是 Error 实例
    fail(`parse ${manifestFile}: ${(error as Error).message}`)
  }
}

/** 选择清单文件：pet.json 优先，legacy avatar.json 兜底，都没有返回 null（非宠物目录）。 */
async function manifestOf(petDir: string): Promise<string | null> {
  for (const name of ['pet.json', 'avatar.json']) {
    try {
      await stat(join(petDir, name))
      return name
    } catch {
      // ENOENT：尝试下一个候选名
    }
  }
  return null
}

/**
 * 扫描宠物根目录：含清单的子目录各产出一只校验过的宠物；无清单的条目跳过。
 * @param petsDir - 宠物根目录（必须已存在；存在性策略在插件层判定）。
 * @returns 扫描到的宠物（目录顺序）。
 * @throws 任一声明了清单的宠物校验失败时抛错（响亮失败）。
 */
export async function scanPets(petsDir: string): Promise<ScannedPet[]> {
  const entries = await readdir(petsDir, { withFileTypes: true })
  const pets: ScannedPet[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const pet = await loadPet(petsDir, entry.name)
    if (pet !== null) pets.push(pet)
  }
  return pets
}
