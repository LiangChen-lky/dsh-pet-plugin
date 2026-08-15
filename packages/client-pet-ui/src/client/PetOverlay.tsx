/**
 * PetOverlay: the shell.overlay entry composing the sprite with live session
 * activity, drag-and-toss physics, the v2 look ring, the notification bubble,
 * and the pet picker. The overlay layer is click-through, so only the sprite,
 * bubble, and picker opt back into pointer events.
 */
import { useEffect, useRef, useState } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { lookFrameForVector, type PetAnimationMap, type SpriteFrame } from './animation.ts'
import type { PetActivity, PetCatalog, PetCatalogEntry } from './contract/types.ts'
import type { PetKey } from './locales.ts'
import type { createPetStore } from './store.ts'
import { PetBubble } from './PetBubble.tsx'
import { PetPicker } from './PetPicker.tsx'
import { PetSprite } from './PetSprite.tsx'
import css from './PetOverlay.module.css'

/** Registration-side inject face: the activity observable compartment. */
export interface PetOverlayInjected {
  hooks: {
    /** Current-session activity, bound by the renderer as usePetActivity. */
    petActivity: ObservableSnapshot<PetActivity>
  }
}

/** PetOverlay props: the four derived shares (specs feed the same members as stubs). */
export type PetOverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createPetStore>>
  & PropsLocale<'pet'>
  & InjectFace<PetOverlayInjected>

/** 拖拽判定的位移阈值（Codex 契约值 4px）。 */
const DRAG_THRESHOLD_PX = 4
/** 抛掷的逐帧速度衰减（Codex 宠物语义：只滑行，不反弹）。 */
const TOSS_FRICTION = 0.92
/** 松手初速度上限（px/ms）：防止快速甩动把宠物抛出视线。 */
const TOSS_MAX_SPEED = 1.5
/** 低于该速度（px/ms）抛掷结束。 */
const TOSS_STOP_SPEED = 0.02
/** 渲染宽度（px）。 */
const SPRITE_WIDTH_PX = 112
/** 契约单元格宽高比（高/宽）。 */
const CELL_ASPECT = 208 / 192
/** 气泡错误摘要的最大长度。 */
const ERROR_EXCERPT_CHARS = 80
/** catalog 路由（与 host 插件的线协议常量一致）。 */
const CATALOG_URL = '/pet-assets/catalog.json'

/** 一次拖拽会话的跟踪状态。 */
interface DragSession {
  pointerId: number
  startX: number
  startY: number
  baseRight: number
  baseBottom: number
  prevX: number
  lastX: number
  lastY: number
  lastT: number
  vx: number
  vy: number
  moved: boolean
}

/**
 * 目录首只宠物。调用方保证 pets 非空。
 * @param pets - 非空的目录条目。
 * @returns 首个条目。
 */
function firstPet(pets: readonly PetCatalogEntry[]): PetCatalogEntry {
  const first = pets[0]
  /* v8 ignore next 2 -- 调用方已查 pets.length > 0，[0] 恒存在 */
  if (first === undefined) throw new Error('firstPet: empty pets')
  return first
}

/** 视口内的合法偏移范围（页内宠物与桌面窗口不同，拖出视口即丢失）。 */
function clampToViewport(right: number, bottom: number, spriteHeight: number): { right: number; bottom: number } {
  return {
    right: Math.min(Math.max(right, 0), window.innerWidth - SPRITE_WIDTH_PX),
    bottom: Math.min(Math.max(bottom, 0), window.innerHeight - spriteHeight),
  }
}

/** 主序列时长（闪显状态的展示时长：loopStart 之前的帧总长）。 */
function primaryDurationMs(animations: PetAnimationMap, name: string): number {
  const track = animations[name]
  /* v8 ignore next 2 -- host 目录恒解析出完整默认表（含 waving/review），undefined 只是类型防线 */
  if (track === undefined) return 1000
  const stop = track.loopStart ?? track.frames.length
  return track.frames.slice(0, stop).reduce((sum, frame) => sum + frame.durationMs, 0)
}

/**
 * Render the floating pet over the shell.
 * @param props - store/activity hooks, actions, and the translate seat.
 * @returns the overlay element, or null while no pet is available.
 */
export function PetOverlay(props: PetOverlayProps): React.JSX.Element | null {
  const { useStore, actions, usePetActivity, t } = props
  const selectedPetId = useStore(s => s.selectedPetId)
  const storedRight = useStore(s => s.right)
  const storedBottom = useStore(s => s.bottom)
  const pickerOpen = useStore(s => s.pickerOpen)
  const bubbleDismissedKey = useStore(s => s.bubbleDismissedKey)
  const activity = usePetActivity(s => s)

  const [catalog, setCatalog] = useState<PetCatalog | null>(null)
  const [dragOffset, setDragOffset] = useState<{ right: number; bottom: number } | null>(null)
  const [dragRun, setDragRun] = useState<'running-left' | 'running-right' | null>(null)
  const [flash, setFlash] = useState<'waving' | 'review' | null>(null)
  const [lookFrame, setLookFrame] = useState<SpriteFrame | null>(null)

  const boxRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragSession | null>(null)
  const tossRef = useRef<number | null>(null)
  const lookRafRef = useRef<number | null>(null)
  const prevActivityRef = useRef(activity.state)
  const greetedRef = useRef(false)

  // catalog 一次性拉取：host 未挂 pet-assets 或目录为空时宠物整体不渲染
  useEffect(() => {
    let dead = false
    fetch(CATALOG_URL)
      .then((res) => {
        if (!res.ok) throw new Error('catalog ' + String(res.status))
        return res.json() as Promise<PetCatalog>
      })
      .then((doc) => { if (!dead) setCatalog(doc) })
      // 拉取失败（host 未挂 pet-assets 等组合缺位）按无宠物处理：整体不渲染
      .catch(() => { if (!dead) setCatalog({ version: 1, pets: [] }) })
    return () => { dead = true }
  }, [])

  const pet: PetCatalogEntry | null = catalog === null || catalog.pets.length === 0
    ? null
    : catalog.pets.find(p => p.id === selectedPetId) ?? firstPet(catalog.pets)

  // 打招呼：宠物首次出现时 waving 一遍（时长 = 主序列 3 遍的总长）
  useEffect(() => {
    if (pet === null || greetedRef.current) return
    greetedRef.current = true
    setFlash('waving')
    const timer = window.setTimeout(() => { setFlash(null) }, primaryDurationMs(pet.animations, 'waving'))
    return () => { window.clearTimeout(timer) }
  }, [pet])

  // 回合完成（running → idle 且无等待/错误）时 review 一闪
  useEffect(() => {
    const prev = prevActivityRef.current
    prevActivityRef.current = activity.state
    if (prev === 'running' && activity.state === 'idle' && pet !== null) {
      setFlash('review')
      const timer = window.setTimeout(() => { setFlash(null) }, primaryDurationMs(pet.animations, 'review'))
      return () => { window.clearTimeout(timer) }
    }
  }, [activity.state, pet])

  const spriteHeight = Math.round(SPRITE_WIDTH_PX * CELL_ASPECT)

  // 抛掷：松手速度驱动的 rAF 运动，视口边缘反弹，停稳后落盘位置
  const startToss = (vx: number, vy: number, startRight: number, startBottom: number): void => {
    let right = startRight
    let bottom = startBottom
    const capped = Math.hypot(vx, vy)
    const scale = capped > TOSS_MAX_SPEED ? TOSS_MAX_SPEED / capped : 1
    let velX = vx * scale
    let velY = vy * scale
    let last = performance.now()
    const tick = (): void => {
      const now = performance.now()
      const dt = Math.min(64, now - last)
      last = now
      right -= velX * dt
      bottom -= velY * dt
      velX *= TOSS_FRICTION
      velY *= TOSS_FRICTION
      const maxRight = window.innerWidth - SPRITE_WIDTH_PX
      const maxBottom = window.innerHeight - spriteHeight
      // 宠物模式边缘即停（不反弹）：抵达边缘的分量速度归零
      if (right < 0) { right = 0; velX = 0 }
      if (right > maxRight) { right = maxRight; velX = 0 }
      if (bottom < 0) { bottom = 0; velY = 0 }
      if (bottom > maxBottom) { bottom = maxBottom; velY = 0 }
      if (Math.abs(velX) >= 0.1) setDragRun(velX > 0 ? 'running-right' : 'running-left')
      setDragOffset({ right, bottom })
      if (Math.hypot(velX, velY) < TOSS_STOP_SPEED) {
        tossRef.current = null
        setDragOffset(null)
        setDragRun(null)
        actions.setPosition(right, bottom)
        return
      }
      tossRef.current = window.requestAnimationFrame(tick)
    }
    tossRef.current = window.requestAnimationFrame(tick)
  }

  const cancelToss = (): void => {
    if (tossRef.current !== null) window.cancelAnimationFrame(tossRef.current)
    tossRef.current = null
  }

  // 卸载时停掉抛掷
  useEffect(() => cancelToss, [])

  // v2 注视环：跟随窗口指针（rAF 节流），仅 idle/running/waving 可注视
  const lookEligible = dragRun === null && pet !== null && pet.spriteVersion === 2
    && (flash === 'waving' || (flash === null && (activity.state === 'idle' || activity.state === 'running')))
  useEffect(() => {
    if (!lookEligible) {
      setLookFrame(null)
      return
    }
    const onMove = (event: PointerEvent): void => {
      if (lookRafRef.current !== null) return
      lookRafRef.current = window.requestAnimationFrame(() => {
        lookRafRef.current = null
        const box = boxRef.current?.getBoundingClientRect()
        /* v8 ignore next 2 -- 监听期间组件恒已挂载，box 恒存在 */
        if (!box) return
        setLookFrame(lookFrameForVector(
          event.clientX - (box.left + box.width / 2),
          event.clientY - (box.top + box.height / 2),
          pet.frame.rows,
        ))
      })
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (lookRafRef.current !== null) window.cancelAnimationFrame(lookRafRef.current)
      lookRafRef.current = null
    }
  }, [lookEligible, pet])

  if (pet === null || catalog === null) return null
  // 早退之后：catalog 已窄化为非空，选择器直接读全量条目
  const pets = catalog.pets

  const right = dragOffset?.right ?? storedRight
  const bottom = dragOffset?.bottom ?? storedBottom
  const state = dragRun ?? flash ?? activity.state

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    cancelToss()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseRight: right,
      baseBottom: bottom,
      prevX: event.clientX,
      lastX: event.clientX,
      lastY: event.clientY,
      lastT: performance.now(),
      vx: 0,
      vy: 0,
      moved: false,
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const session = dragRef.current
    if (session === null || session.pointerId !== event.pointerId) return
    const dx = event.clientX - session.startX
    const dy = event.clientY - session.startY
    if (!session.moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return
    session.moved = true
    const now = performance.now()
    const dt = Math.max(1, now - session.lastT)
    session.vx = (event.clientX - session.lastX) / dt
    session.vy = (event.clientY - session.lastY) / dt
    session.lastX = event.clientX
    session.lastY = event.clientY
    session.lastT = now
    const stepX = event.clientX - session.prevX
    session.prevX = event.clientX
    // 水平拖动切换奔跑朝向（Codex 契约：单事件位移 ≥4px 才换向）
    if (stepX >= DRAG_THRESHOLD_PX) setDragRun('running-right')
    else if (stepX <= -DRAG_THRESHOLD_PX) setDragRun('running-left')
    // bottom 是距底边偏移：指针向下（dy>0）时偏移减小，宠物跟随向下
    setDragOffset(clampToViewport(session.baseRight - dx, session.baseBottom - dy, spriteHeight))
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): DragSession | null => {
    const session = dragRef.current
    if (session === null || session.pointerId !== event.pointerId) return null
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    return session
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const session = endDrag(event)
    if (session === null) return
    if (!session.moved) {
      // 未位移的点击：开合宠物选择器
      actions.setPickerOpen(!pickerOpen)
      return
    }
    const settledRight = session.baseRight - (session.lastX - session.startX)
    const settledBottom = session.baseBottom - (session.lastY - session.startY)
    startToss(session.vx, session.vy, settledRight, settledBottom)
  }

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>): void => {
    // 取消不算点击也不抛掷：原位落定
    const session = endDrag(event)
    if (session === null || !session.moved) return
    setDragOffset(null)
    setDragRun(null)
    const settledRight = session.baseRight - (session.lastX - session.startX)
    const settledBottom = session.baseBottom - (session.lastY - session.startY)
    const settled = clampToViewport(settledRight, settledBottom, spriteHeight)
    actions.setPosition(settled.right, settled.bottom)
  }

  // 气泡事实：同一事实只打扰一次（dismiss 按键记忆），新事实重新弹出
  const bubble: { key: string; title: string; detail: string } | null = activity.state === 'waiting'
    ? {
      key: 'waiting:' + activity.waitingKind,
      title: t('bubble.waiting'),
      detail: t(('bubble.waiting.' + activity.waitingKind) as PetKey),
    }
    : activity.state === 'failed'
      ? { key: 'failed:' + activity.error, title: t('bubble.failed'), detail: activity.error.slice(0, ERROR_EXCERPT_CHARS) }
      : null
  const showBubble = bubble !== null && bubbleDismissedKey !== bubble.key

  return (
    <div className={css.root} style={{ right, bottom }} data-testid="pet-overlay">
      {flash === 'review' ? (
        <PetBubble
          title={t('bubble.review')}
          dismissLabel={t('bubble.dismiss')}
          onDismiss={() => { setFlash(null) }}
          className={css.bubble}
          titleClassName={css.bubbleTitle}
          detailClassName={css.bubbleDetail}
          dismissClassName={css.bubbleDismiss}
        />
      ) : showBubble ? (
        <PetBubble
          title={bubble.title}
          detail={bubble.detail}
          dismissLabel={t('bubble.dismiss')}
          onDismiss={() => { actions.dismissBubble(bubble.key) }}
          className={css.bubble}
          titleClassName={css.bubbleTitle}
          detailClassName={css.bubbleDetail}
          dismissClassName={css.bubbleDismiss}
        />
      ) : null}
      <div
        ref={boxRef}
        className={css.spriteBox}
        role="button"
        aria-label={t('pet.aria')}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(event) => { event.preventDefault(); actions.setPickerOpen(!pickerOpen) }}
      >
        <PetSprite
          url={pet.spriteUrl + '?v=' + String(pet.mtimeMs)}
          columns={pet.frame.columns}
          rows={pet.frame.rows}
          frameCount={pet.frame.columns * pet.frame.rows}
          animations={pet.animations}
          state={state}
          lookFrame={lookFrame}
          respondToHover={dragRun === null}
          widthPx={SPRITE_WIDTH_PX}
        />
      </div>
      {pickerOpen ? (
        <PetPicker
          pets={pets}
          selectedId={pet.id}
          onSelect={(id) => { actions.selectPet(id) }}
          onClose={() => { actions.setPickerOpen(false) }}
          t={t}
          classes={{
            root: css.picker,
            title: css.pickerTitle,
            close: css.pickerClose,
            grid: css.pickerGrid,
            option: css.pickerOption,
            optionSelected: css.pickerOptionSelected,
            preview: css.pickerPreview,
            name: css.pickerName,
            empty: css.pickerEmpty,
          }}
        />
      ) : null}
    </div>
  )
}
