/**
 * Activity derivation matrix and the source's subscription behavior:
 * selection following, conversation rebinding, and reference stability.
 */
import { describe, expect, it } from 'vitest'
import {
  createPetActivitySource, deriveActivity,
  type ActivityConversationFact, type PetActivitySessions,
} from '../src/client/activity.ts'

/** 可写假源：getSnapshot/subscribe + set 触发通知 + setSilent 静默替换。 */
function source<T>(initial: T): {
  getSnapshot: () => T
  subscribe: (fn: () => void) => () => void
  set: (value: T) => void
  setSilent: (value: T) => void
} {
  let value = initial
  const subs = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(fn) {
      subs.add(fn)
      return () => { subs.delete(fn) }
    },
    set(next) {
      value = next
      for (const fn of subs) fn()
    },
    setSilent(next) {
      value = next
    },
  }
}

function convo(over: Partial<ActivityConversationFact> = {}): ActivityConversationFact {
  return { running: false, pending: [], lastAgentError: null, ...over }
}

describe('deriveActivity', () => {
  it('is idle without any facts', () => {
    expect(deriveActivity(undefined, undefined)).toEqual({ state: 'idle' })
  })

  it('maps a running turn from either fact layer', () => {
    expect(deriveActivity({ running: true }, undefined).state).toBe('running')
    expect(deriveActivity(undefined, convo({ running: true })).state).toBe('running')
  })

  it('maps pending interactions to waiting with their kind', () => {
    expect(deriveActivity({ running: false, pendingInteraction: 'approval' }, undefined))
      .toEqual({ state: 'waiting', waitingKind: 'approval' })
    // 会话快照的待处理项优先于列表摘要
    expect(deriveActivity({ running: false, pendingInteraction: 'approval' }, convo({ pending: [{ kind: 'question' }] })))
      .toEqual({ state: 'waiting', waitingKind: 'question' })
  })

  it('maps a persisted agent error to failed', () => {
    expect(deriveActivity(undefined, convo({ lastAgentError: 'boom' })))
      .toEqual({ state: 'failed', error: 'boom' })
  })

  it('orders waiting above failed above running', () => {
    const facts = convo({ running: true, pending: [{ kind: 'approval' }], lastAgentError: 'boom' })
    expect(deriveActivity(undefined, facts).state).toBe('waiting')
    expect(deriveActivity(undefined, convo({ running: true, lastAgentError: 'boom' })).state).toBe('failed')
  })

  it('maps a plan-review wait to its own kind', () => {
    expect(deriveActivity({ running: false, pendingInteraction: 'plan-review' }, undefined))
      .toEqual({ state: 'waiting', waitingKind: 'plan-review' })
  })

  it('treats unknown pending kinds as a generic question', () => {
    const derived = deriveActivity(undefined, convo({ pending: [{ kind: 'elicitation' }] }))
    expect(derived.state === 'waiting' && derived.waitingKind === 'question').toBe(true)
  })
})

describe('createPetActivitySource', () => {
  /** 测试列表快照形状。 */
  interface ListSnap { current: string | undefined; byId: Record<string, { running: boolean }> }

  /** 可写源别名。 */
  type Writable<T> = ReturnType<typeof source<T>>

  function bench(): {
    sessions: PetActivitySessions
    list: Writable<ListSnap>
    convos: Map<string, Writable<ActivityConversationFact>>
  } {
    const list = source<ListSnap>({ current: undefined, byId: {} })
    const convos = new Map<string, ReturnType<typeof source<ActivityConversationFact>>>()
    const sessions: PetActivitySessions = {
      list,
      binding: (id) => {
        const session = convos.get(id)
        return session === undefined ? undefined : { session }
      },
    }
    return { sessions, list, convos }
  }

  it('follows the selection and rebinds the conversation source', () => {
    const { sessions, list, convos } = bench()
    convos.set('a', source(convo({ running: true })))
    convos.set('b', source(convo()))
    const activity = createPetActivitySource(sessions)
    const seen: string[] = []
    const off = activity.subscribe(() => { seen.push(activity.getSnapshot().state) })

    list.set({ current: 'a', byId: { a: { running: true } } })
    expect(activity.getSnapshot().state).toBe('running')
    list.set({ current: 'b', byId: { b: { running: false } } })
    expect(activity.getSnapshot().state).toBe('idle')
    // 换绑后 b 的会话快照变化继续驱动
    convos.get('b')!.set(convo({ pending: [{ kind: 'approval' }] }))
    expect(activity.getSnapshot().state).toBe('waiting')
    expect(seen).toContain('running')
    expect(seen).toContain('waiting')
    off()
  })

  it('keeps the published reference stable while the derived fact stands', () => {
    const { sessions, list } = bench()
    const activity = createPetActivitySource(sessions)
    const off = activity.subscribe(() => {})
    const first = activity.getSnapshot()
    // 列表快照换了对象但派生事实未变：引用不动
    list.set({ current: undefined, byId: {} })
    expect(activity.getSnapshot()).toBe(first)
    off()
  })

  it('catches up a silently replaced list snapshot on the next read', () => {
    const { sessions, list, convos } = bench()
    convos.set('a', source(convo({ running: true })))
    const activity = createPetActivitySource(sessions)
    const off = activity.subscribe(() => {})
    activity.getSnapshot()
    // 快照被静默换掉（未通知）：getSnapshot 的换订检查必须追上新选择
    list.setSilent({ current: 'a', byId: { a: { running: true } } })
    expect(activity.getSnapshot().state).toBe('running')
    off()
  })

  it('keeps the reference across an identical failed fact and moves on a new error', () => {
    const { sessions, list, convos } = bench()
    convos.set('a', source(convo({ lastAgentError: 'boom' })))
    const activity = createPetActivitySource(sessions)
    const off = activity.subscribe(() => {})
    list.set({ current: 'a', byId: { a: { running: false } } })
    const first = activity.getSnapshot()
    expect(first).toEqual({ state: 'failed', error: 'boom' })
    // 相同错误的新快照对象：引用不动
    convos.get('a')!.set(convo({ lastAgentError: 'boom' }))
    expect(activity.getSnapshot()).toBe(first)
    // 新错误：发布新值
    convos.get('a')!.set(convo({ lastAgentError: 'different' }))
    expect(activity.getSnapshot()).toEqual({ state: 'failed', error: 'different' })
    off()
  })

  it('reads the list summary when the binding is absent', () => {
    const { sessions, list } = bench()
    const activity = createPetActivitySource(sessions)
    const off = activity.subscribe(() => {})
    list.set({ current: 'ghost', byId: { ghost: { running: true } } })
    expect(activity.getSnapshot().state).toBe('running')
    off()
  })
})
