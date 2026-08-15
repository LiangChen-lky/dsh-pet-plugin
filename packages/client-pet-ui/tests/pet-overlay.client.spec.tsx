// @vitest-environment jsdom
/**
 * PetOverlay behavior over stubbed framework seats: catalog fetch, greeting
 * and completion flashes, activity-driven state and bubbles, click-to-pick,
 * and drag direction plus toss settling.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { PetActivity, PetCatalog } from '../src/client/contract/types.ts'
import { zh } from '../src/client/locales.ts'
import { PetOverlay, type PetOverlayProps } from '../src/client/PetOverlay.tsx'
import type { PetOverlayState } from '../src/client/store.ts'

const t = makeTranslate(zh)

/** 契约动画表夹具（waving/review 供闪显计时）。 */
function fixtureAnimations(): PetCatalog['pets'][number]['animations'] {
  const idle = {
    frames: [0, 1].map(i => ({ spriteIndex: i, durationMs: 100 })),
    loopStart: 0 as number | null,
    fallback: 'idle',
  }
  const state = (row: number, count: number) => {
    const primary = Array.from({ length: count }, (_, c) => ({ spriteIndex: row * 8 + c, durationMs: 100 }))
    return { frames: [...primary, ...primary, ...primary, ...idle.frames], loopStart: primary.length * 3 as number | null, fallback: 'idle' }
  }
  return {
    idle,
    waving: state(3, 4),
    jumping: state(4, 5),
    failed: state(5, 8),
    waiting: state(6, 6),
    running: state(7, 6),
    review: state(8, 6),
  }
}

/** 一只宠物的目录文档（v2 换注视环行数）。 */
function catalog(version: 1 | 2 = 1): PetCatalog {
  return {
    version: 1,
    pets: [{
      id: 'chefito',
      displayName: 'Chefito',
      description: 'A tiny chef',
      spriteUrl: '/pet-assets/sprites/chefito/spritesheet.webp',
      spriteVersion: version,
      frame: version === 2
        ? { width: 192, height: 208, columns: 8, rows: 11 }
        : { width: 192, height: 208, columns: 8, rows: 9 },
      animations: fixtureAnimations(),
      mtimeMs: 42,
    }],
  }
}

/** 动作桩类型：每个 action 一个 Mock。 */
type PetOverlayActions = {
  selectPet: Mock<(id: string) => void>
  setPosition: Mock<(right: number, bottom: number) => void>
  setPickerOpen: Mock<(open: boolean) => void>
  dismissBubble: Mock<(key: string) => void>
}

/** 座位桩：store/activity 为普通对象 + 选择器函数，actions 为 Mock。 */
function bench(over: {
  state?: Partial<PetOverlayState>
  activity?: PetActivity
} = {}): { props: PetOverlayProps; actions: PetOverlayActions; setActivity: (next: PetActivity) => void } {
  const state: PetOverlayState = {
    selectedPetId: null,
    right: 24,
    bottom: 24,
    pickerOpen: false,
    bubbleDismissedKey: null,
    ...over.state,
  }
  const holder: { current: PetActivity } = { current: over.activity ?? { state: 'idle' } }
  const actions = {
    selectPet: vi.fn(),
    setPosition: vi.fn(),
    setPickerOpen: vi.fn((open: boolean) => { state.pickerOpen = open }),
    dismissBubble: vi.fn((key: string) => { state.bubbleDismissedKey = key }),
  }
  const props = {
    useStore: <S,>(select: (snapshot: PetOverlayState) => S): S => select(state),
    actions,
    usePetActivity: <S,>(select: (snapshot: PetActivity) => S): S => select(holder.current),
    t,
  } as unknown as PetOverlayProps
  return { props, actions, setActivity: (next: PetActivity) => { holder.current = next } }
}

/** 渲染并冲掉 catalog 拉取微任务。 */
async function renderOverlay(props: PetOverlayProps): Promise<ReturnType<typeof render>> {
  const view = render(<PetOverlay {...props} />)
  await act(async () => {})
  return view
}

function spriteState(container: HTMLElement): string | undefined {
  return container.querySelector('[data-dsh-pet-state]')?.getAttribute('data-dsh-pet-state') ?? undefined
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(catalog()),
  })))
  vi.stubGlobal('requestAnimationFrame', (fn: (time: number) => void) => window.setTimeout(() => { fn(performance.now()) }, 16))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { window.clearTimeout(id) })
  // jsdom 无指针捕获实现（ui-layout 测试同款 polyfill）
  Element.prototype.setPointerCapture = function () {}
  Element.prototype.releasePointerCapture = function () {}
  Element.prototype.hasPointerCapture = function () { return true }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PetOverlay', () => {
  it('renders nothing until the catalog arrives, then greets with waving', async () => {
    const { container } = render(<PetOverlay {...bench().props} />)
    expect(container.innerHTML).toBe('')
    await act(async () => {})
    expect(spriteState(container)).toBe('waving')
    // 打招呼时长 = waving 主序列 3 遍（12 帧 x 100ms）
    act(() => { vi.advanceTimersByTime(1200) })
    expect(spriteState(container)).toBe('idle')
  })

  it('renders nothing when the catalog has no pets', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({ version: 1, pets: [] }) } as Response)
    const { container } = await renderOverlay(bench().props)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the catalog fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('no host'))
    const { container } = await renderOverlay(bench().props)
    expect(container.innerHTML).toBe('')
  })

  it('follows the activity state after the greeting', async () => {
    const { container } = await renderOverlay(bench({ activity: { state: 'running' } }).props)
    act(() => { vi.advanceTimersByTime(1200) })
    expect(spriteState(container)).toBe('running')
  })

  it('shows the waiting bubble with its kind and dismisses it per fact', async () => {
    const b = bench({ activity: { state: 'waiting', waitingKind: 'approval' } })
    const view = await renderOverlay(b.props)
    expect(view.getByText('需要输入')).toBeDefined()
    expect(view.getByText('有操作等待审批')).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: '知道了' }))
    expect(b.actions.dismissBubble).toHaveBeenCalledWith('waiting:approval')
  })

  it('shows the failed bubble with an error excerpt', async () => {
    const view = await renderOverlay(bench({ activity: { state: 'failed', error: 'turn exploded' } }).props)
    expect(view.getByText('出错了')).toBeDefined()
    expect(view.getByText('turn exploded')).toBeDefined()
  })

  it('flashes review when a running turn settles into idle', async () => {
    const b = bench({ activity: { state: 'running' } })
    const view = await renderOverlay(b.props)
    act(() => { vi.advanceTimersByTime(1200) })
    expect(spriteState(view.container)).toBe('running')
    // 活动切到 idle：review 一闪（含“已完成”气泡），时长 = review 主序列 3 遍
    view.rerender(<PetOverlay {...bench({ activity: { state: 'idle' } }).props} />)
    expect(spriteState(view.container)).toBe('review')
    expect(view.getByText('已完成')).toBeDefined()
    act(() => { vi.advanceTimersByTime(1800) })
    expect(spriteState(view.container)).toBe('idle')
  })

  it('toggles the picker on a click without drag and forwards selection', async () => {
    const b = bench()
    const view = await renderOverlay(b.props)
    const box = view.getByRole('button', { name: '桌面宠物' })
    fireEvent.pointerDown(box, { button: 0, clientX: 500, clientY: 500, pointerId: 1 })
    fireEvent.pointerUp(box, { clientX: 500, clientY: 500, pointerId: 1 })
    expect(b.actions.setPickerOpen).toHaveBeenCalledWith(true)
    // 桩没有订阅通知：手动重渲染读取更新后的 state
    view.rerender(<PetOverlay {...b.props} />)
    const option = view.getByRole('button', { name: /Chefito/ })
    fireEvent.click(option)
    expect(b.actions.selectPet).toHaveBeenCalledWith('chefito')
    fireEvent.click(view.getByRole('button', { name: '关闭' }))
    expect(b.actions.setPickerOpen).toHaveBeenCalledWith(false)
  })

  it('runs right while dragging right and persists the settled position', async () => {
    const b = bench()
    const view = await renderOverlay(b.props)
    act(() => { vi.advanceTimersByTime(1200) })
    const box = view.getByRole('button', { name: '桌面宠物' })
    fireEvent.pointerDown(box, { button: 0, clientX: 100, clientY: 500, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(30) })
    fireEvent.pointerMove(box, { clientX: 130, clientY: 500, pointerId: 1 })
    expect(spriteState(view.container)).toBe('running-right')
    act(() => { vi.advanceTimersByTime(30) })
    fireEvent.pointerUp(box, { clientX: 130, clientY: 500, pointerId: 1 })
    // 抛掷衰减到停：位置落盘且不超出视口
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(b.actions.setPosition).toHaveBeenCalled()
    const call = b.actions.setPosition.mock.calls[0]
    const right = call?.[0] ?? -1
    expect(right).toBeGreaterThanOrEqual(0)
    expect(right).toBeLessThanOrEqual(window.innerWidth - 112)
  })
})
describe('PetOverlay edges', () => {
  it('falls back to the first pet when the stored selection is unknown', async () => {
    const b = bench({ state: { selectedPetId: 'ghost' } })
    const view = await renderOverlay(b.props)
    expect(view.getByTestId('pet-overlay')).toBeDefined()
    expect(spriteState(view.container)).toBe('waving')
  })

  it('renders nothing when the catalog answers not-ok', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) } as unknown as Response)
    const view = await renderOverlay(bench().props)
    expect(view.container.innerHTML).toBe('')
  })

  it('ignores a fetch resolving after unmount', async () => {
    let resolveFetch: (value: Response | PromiseLike<Response>) => void = () => {}
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((resolve) => { resolveFetch = resolve }))
    const view = render(<PetOverlay {...bench().props} />)
    view.unmount()
    resolveFetch({ ok: true, json: () => Promise.resolve(catalog()) } as unknown as Response)
    await act(async () => {})
    expect(view.container.innerHTML).toBe('')
  })

  it('ignores a fetch rejecting after unmount', async () => {
    let rejectFetch: (reason: unknown) => void = () => {}
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((_, reject) => { rejectFetch = reject }))
    const view = render(<PetOverlay {...bench().props} />)
    view.unmount()
    rejectFetch(new Error('late'))
    await act(async () => {})
    expect(view.container.innerHTML).toBe('')
  })

  it('tracks the pointer with the v2 look ring while idle', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve(catalog(2)) } as Response)
    const view = await renderOverlay(bench().props)
    act(() => { vi.advanceTimersByTime(1200) })
    const sprite = () => view.container.querySelector('[data-dsh-pet-state]') as HTMLElement
    expect(sprite().style.backgroundPosition).toBe('0% 0%')
    // jsdom 的 rect 全零 → 指针向量即 clientX/Y
    fireEvent.pointerMove(document.body, { clientX: 1024, clientY: 800 })
    act(() => { vi.advanceTimersByTime(32) })
    expect(sprite().style.backgroundPosition).toBe('85.71428571428571% 90%')
  })

  it('ignores a non-left-button press', async () => {
    const b = bench()
    const view = await renderOverlay(b.props)
    const box = view.getByRole('button', { name: '桌面宠物' })
    fireEvent.pointerDown(box, { button: 2, clientX: 100, clientY: 100, pointerId: 2 })
    fireEvent.pointerMove(box, { clientX: 300, clientY: 100, pointerId: 2 })
    fireEvent.pointerUp(box, { clientX: 300, clientY: 100, pointerId: 2 })
    expect(b.actions.setPickerOpen).not.toHaveBeenCalled()
    expect(b.actions.setPosition).not.toHaveBeenCalled()
  })

  it('treats a sub-threshold move as a click', async () => {
    const b = bench()
    const view = await renderOverlay(b.props)
    const box = view.getByRole('button', { name: '桌面宠物' })
    fireEvent.pointerDown(box, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(box, { clientX: 102, clientY: 101, pointerId: 1 })
    expect(spriteState(view.container)).not.toBe('running-right')
    fireEvent.pointerUp(box, { clientX: 102, clientY: 101, pointerId: 1 })
    expect(b.actions.setPickerOpen).toHaveBeenCalledWith(true)
  })

  it('moves vertically without a running state', async () => {
    const b = bench()
    const view = await renderOverlay(b.props)
    act(() => { vi.advanceTimersByTime(1200) })
    const box = view.getByRole('button', { name: '桌面宠物' })
    fireEvent.pointerDown(box, { button: 0, clientX: 100, clientY: 500, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(30) })
    // 向上拖 100px：bottom 偏移应增大 100（宠物跟随指针向上）
    fireEvent.pointerMove(box, { clientX: 101, clientY: 400, pointerId: 1 })
    const root = view.getByTestId('pet-overlay')
    expect(root.style.bottom).toBe('124px')
    // 纯垂直拖动：有位移但不切奔跑
    expect(['idle', undefined]).toContain(spriteState(view.container))
    fireEvent.pointerUp(box, { clientX: 101, clientY: 400, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(60_000) })
    // 抛掷起点 = 释放点（bottom 124），向上初速度继续上滑；落定必须仍在底部以上
    const call = b.actions.setPosition.mock.calls[0]
    expect(call).toBeDefined()
    expect(call?.[1]).toBeGreaterThan(124)
  })

  it('ignores a stray pointerup without a drag session', async () => {
    const b = bench()
    const view = await renderOverlay(b.props)
    const box = view.getByRole('button', { name: '桌面宠物' })
    fireEvent.pointerUp(box, { clientX: 100, clientY: 100, pointerId: 9 })
    expect(b.actions.setPickerOpen).not.toHaveBeenCalled()
  })

  it('settles in place on pointercancel after a real move', async () => {
    const b = bench()
    const view = await renderOverlay(b.props)
    act(() => { vi.advanceTimersByTime(1200) })
    const box = view.getByRole('button', { name: '桌面宠物' })
    fireEvent.pointerDown(box, { button: 0, clientX: 100, clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(box, { clientX: 160, clientY: 500, pointerId: 1 })
    expect(spriteState(view.container)).toBe('running-right')
    fireEvent.pointerCancel(box, { clientX: 160, clientY: 500, pointerId: 1 })
    // 取消：原位落定，不抛掷
    expect(b.actions.setPosition).toHaveBeenCalledWith(0, 24)
    expect(b.actions.setPickerOpen).not.toHaveBeenCalled()
    expect(spriteState(view.container)).toBe('idle')
  })

  it('clamps the drag position inside the viewport', async () => {
    const b = bench()
    const view = await renderOverlay(b.props)
    act(() => { vi.advanceTimersByTime(1200) })
    const box = view.getByRole('button', { name: '桌面宠物' })
    // 向右拖出视口：right 偏移被钳到 0（页内宠物不允许拖丢）
    fireEvent.pointerDown(box, { button: 0, clientX: 100, clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(box, { clientX: 100 + 5000, clientY: 500, pointerId: 1 })
    const root = view.getByTestId('pet-overlay')
    expect(root.style.right).toBe('0px')
    fireEvent.pointerUp(box, { clientX: 5100, clientY: 500, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(60_000) })
  })

  it('stops at the right and top edges during a fast toss (no bounce)', async () => {
    const b = bench()
    const view = await renderOverlay(b.props)
    act(() => { vi.advanceTimersByTime(1200) })
    const box = view.getByRole('button', { name: '桌面宠物' })
    // 快速向左上甩：抵达右/上边缘即停（不反弹）
    fireEvent.pointerDown(box, { button: 0, clientX: 900, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(box, { clientX: 100, clientY: -600, pointerId: 1 })
    fireEvent.pointerUp(box, { clientX: 100, clientY: -600, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(120_000) })
    const call = b.actions.setPosition.mock.calls[0]
    expect(call).toBeDefined()
    expect(call?.[0]).toBeLessThanOrEqual(window.innerWidth - 112)
    expect(call?.[1]).toBeGreaterThanOrEqual(0)
  })

  it('stops at the left and bottom edges during a fast toss (no bounce)', async () => {
    // 起始位置离开左缘，抛掷才能滑行数帧（覆盖滑行中的奔跑朝向更新）
    const b = bench({ state: { right: 400, bottom: 400 } })
    const view = await renderOverlay(b.props)
    act(() => { vi.advanceTimersByTime(1200) })
    const box = view.getByRole('button', { name: '桌面宠物' })
    // 快速向右下甩：先向右下滑行（running-right），抵达边缘即停（不反弹）
    fireEvent.pointerDown(box, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(box, { clientX: 400, clientY: 400, pointerId: 1 })
    fireEvent.pointerUp(box, { clientX: 400, clientY: 400, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(120_000) })
    const call = b.actions.setPosition.mock.calls[0]
    expect(call).toBeDefined()
    expect(call?.[0]).toBeGreaterThanOrEqual(0)
    expect(call?.[1]).toBeLessThanOrEqual(window.innerHeight - 121)
  })

  it('cancels the toss frame on unmount', async () => {
    const b = bench()
    const view = await renderOverlay(b.props)
    act(() => { vi.advanceTimersByTime(1200) })
    const box = view.getByRole('button', { name: '桌面宠物' })
    fireEvent.pointerDown(box, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(box, { clientX: 300, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(box, { clientX: 300, clientY: 100, pointerId: 1 })
    view.unmount()
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(b.actions.setPosition).not.toHaveBeenCalled()
  })

  it('toggles the picker from the context menu', async () => {
    const b = bench()
    const view = await renderOverlay(b.props)
    fireEvent.contextMenu(view.getByRole('button', { name: '桌面宠物' }))
    expect(b.actions.setPickerOpen).toHaveBeenCalledWith(true)
  })

  it('dismisses the review bubble without touching the store', async () => {
    const b = bench({ activity: { state: 'running' } })
    const view = await renderOverlay(b.props)
    act(() => { vi.advanceTimersByTime(1200) })
    b.setActivity({ state: 'idle' })
    view.rerender(<PetOverlay {...b.props} />)
    expect(view.getByText('已完成')).toBeDefined()
    fireEvent.click(view.getByRole('button', { name: '知道了' }))
    expect(view.queryByText('已完成')).toBeNull()
    expect(spriteState(view.container)).toBe('idle')
  })

  it('keeps a dismissed bubble hidden and reshows it for a new fact', async () => {
    const b = bench({ activity: { state: 'waiting', waitingKind: 'approval' } })
    const view = await renderOverlay(b.props)
    fireEvent.click(view.getByRole('button', { name: '知道了' }))
    view.rerender(<PetOverlay {...b.props} />)
    expect(view.queryByText('需要输入')).toBeNull()
    // 新的事实种类：气泡重新出现
    b.setActivity({ state: 'waiting', waitingKind: 'question' })
    view.rerender(<PetOverlay {...b.props} />)
    expect(view.getByText('需要输入')).toBeDefined()
    expect(view.getByText('有问题等待回答')).toBeDefined()
  })

  it('tracks the pointer while a turn runs on a v2 pet', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve(catalog(2)) } as Response)
    const b = bench({ activity: { state: 'running' } })
    const view = await renderOverlay(b.props)
    act(() => { vi.advanceTimersByTime(1200) })
    const sprite = () => view.container.querySelector('[data-dsh-pet-state]') as HTMLElement
    expect(sprite().getAttribute('data-dsh-pet-state')).toBe('running')
    fireEvent.pointerMove(document.body, { clientX: 1024, clientY: 800 })
    // 同帧内第二次 pointermove 被节流跳过
    fireEvent.pointerMove(document.body, { clientX: 0, clientY: 800 })
    act(() => { vi.advanceTimersByTime(32) })
    expect(sprite().style.backgroundPosition).toBe('85.71428571428571% 90%')
  })

  it('cancels a pending look frame on unmount', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve(catalog(2)) } as Response)
    const view = await renderOverlay(bench().props)
    act(() => { vi.advanceTimersByTime(1200) })
    fireEvent.pointerMove(document.body, { clientX: 1024, clientY: 800 })
    view.unmount()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(view.container.innerHTML).toBe('')
  })

  it('uses the full frame table when a flash track is a one-shot', async () => {
    const oneShot = catalog()
    const waving = oneShot.pets[0]!.animations['waving']!
    // loopStart null：闪显时长退化为全帧表总长（loopStart ?? frames.length）
    oneShot.pets[0]!.animations['waving'] = { frames: waving.frames.slice(0, 4), loopStart: null, fallback: 'idle' }
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve(oneShot) } as Response)
    const view = await renderOverlay(bench().props)
    expect(spriteState(view.container)).toBe('waving')
    act(() => { vi.advanceTimersByTime(400) })
    expect(spriteState(view.container)).toBe('idle')
  })

  it('settles without releasing capture when none is held', async () => {
    Element.prototype.hasPointerCapture = function () { return false }
    const b = bench()
    const view = await renderOverlay(b.props)
    act(() => { vi.advanceTimersByTime(1200) })
    const box = view.getByRole('button', { name: '桌面宠物' })
    fireEvent.pointerDown(box, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(box, { clientX: 160, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(box, { clientX: 160, clientY: 100, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(b.actions.setPosition).toHaveBeenCalled()
  })

  it('cancelling without a move does nothing', async () => {
    const b = bench()
    const view = await renderOverlay(b.props)
    const box = view.getByRole('button', { name: '桌面宠物' })
    fireEvent.pointerDown(box, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerCancel(box, { clientX: 100, clientY: 100, pointerId: 1 })
    expect(b.actions.setPosition).not.toHaveBeenCalled()
    expect(b.actions.setPickerOpen).not.toHaveBeenCalled()
  })

  it('finds the stored selection when it exists in the catalog', async () => {
    const b = bench({ state: { selectedPetId: 'chefito' } })
    const view = await renderOverlay(b.props)
    expect(view.getByTestId('pet-overlay')).toBeDefined()
  })
})
