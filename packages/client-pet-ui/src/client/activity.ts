/**
 * Current-session activity source: a bare observable combining the sessions
 * list selection with the staged session's conversation snapshot, memoized so
 * the published reference only moves when the derived fact moves. The
 * sessions face is structural — the real ISessions satisfies it, and specs
 * drive the source with plain stubs.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { PetActivity, PetWaitingKind } from './contract/types.ts'

/** List-row fact the source reads (structural subset of SessionSummary). */
export interface ActivitySummaryFact {
  /** A turn is running on this session. */
  running: boolean
  /** Pending interaction kind, when one blocks the session. */
  pendingInteraction?: PetWaitingKind
}

/** Conversation fact the source reads (structural subset of ConversationSnapshot). */
export interface ActivityConversationFact {
  /** A turn is running. */
  running: boolean
  /** Pending interactions (kind discriminates the wait). */
  pending: readonly { readonly kind: string }[]
  /** Latest host/agent error, cleared on the next prompt. */
  lastAgentError: string | null
}

/** Structural sessions face the activity source needs. */
export interface PetActivitySessions {
  /** Session list store (selection plus per-session summaries). */
  list: ObservableSnapshot<{ current: string | undefined; byId: Record<string, ActivitySummaryFact> }>
  /**
   * Resolve the session binding for live conversation facts.
   * @param id - session id from the list snapshot.
   * @returns the binding, or undefined while the session is not staged.
   */
  binding(id: string): { session: ObservableSnapshot<ActivityConversationFact> } | undefined
}

/** 已知等待种类的直通映射；未列出的种类按通用提问处理。 */
function waitingKindOf(kind: string | undefined): PetWaitingKind | null {
  switch (kind) {
    case 'approval': return 'approval'
    case 'plan-review': return 'plan-review'
    case 'question': return 'question'
    case undefined: return null
    default: return 'question'
  }
}

/**
 * Derive the pet activity from list and conversation facts. Priority mirrors
 * the actionability of each state: a pending wait outranks a persisted
 * failure, which outranks a running turn.
 * @param summary - current session's list row, when listed.
 * @param convo - current session's conversation snapshot, when staged.
 * @returns the derived activity.
 */
export function deriveActivity(
  summary: ActivitySummaryFact | undefined, convo: ActivityConversationFact | undefined,
): PetActivity {
  const waitingKind = waitingKindOf(convo?.pending[0]?.kind ?? summary?.pendingInteraction)
  const error = convo?.lastAgentError ?? null
  const running = convo?.running ?? summary?.running ?? false
  if (waitingKind !== null) return { state: 'waiting', waitingKind }
  if (error !== null) return { state: 'failed', error }
  if (running) return { state: 'running' }
  return { state: 'idle' }
}

/** 结构相等比较：同状态且相关字段一致（引用稳定契约的比较器）。 */
function sameActivity(a: PetActivity, b: PetActivity): boolean {
  if (a.state !== b.state) return false
  if (a.state === 'waiting' && b.state === 'waiting') return a.waitingKind === b.waitingKind
  if (a.state === 'failed' && b.state === 'failed') return a.error === b.error
  return true
}

/**
 * Build the petActivity observable: follows the list selection and
 * re-subscribes to the staged session's conversation snapshot as it changes.
 * @param sessions - the sessions service face.
 * @returns bare observable for the inject hooks compartment.
 */
export function createPetActivitySource(sessions: PetActivitySessions): ObservableSnapshot<PetActivity> {
  let listSnapshot = sessions.list.getSnapshot()
  let convoSnapshot: ActivityConversationFact | undefined
  let published: PetActivity = derive()

  function currentConvo(): ObservableSnapshot<ActivityConversationFact> | undefined {
    const current = sessions.list.getSnapshot().current
    return current === undefined ? undefined : sessions.binding(current)?.session
  }

  function derive(): PetActivity {
    const list = sessions.list.getSnapshot()
    const summary = list.current === undefined ? undefined : list.byId[list.current]
    return deriveActivity(summary, convoSnapshot)
  }

  /** 派生事实未变时保住上一次引用（订阅源的引用稳定契约）。 */
  function republish(): PetActivity {
    const next = derive()
    if (sameActivity(next, published)) return published
    published = next
    return published
  }

  return {
    getSnapshot(): PetActivity {
      const list = sessions.list.getSnapshot()
      if (list !== listSnapshot) {
        listSnapshot = list
        convoSnapshot = currentConvo()?.getSnapshot()
      }
      // 静默换订（通知先于本订阅者运行的场景）也要赶上最新派生值
      return republish()
    },
    subscribe(fn: () => void): () => void {
      let offConvo: (() => void) | null = null
      const rebind = (): void => {
        offConvo?.()
        offConvo = null
        const convo = currentConvo()
        if (convo === undefined) return
        offConvo = convo.subscribe(() => {
          convoSnapshot = convo.getSnapshot()
          republish()
          fn()
        })
        convoSnapshot = convo.getSnapshot()
      }
      const offList = sessions.list.subscribe(() => {
        listSnapshot = sessions.list.getSnapshot()
        rebind()
        republish()
        fn()
      })
      rebind()
      republish()
      return () => {
        offList()
        offConvo?.()
      }
    },
  }
}
