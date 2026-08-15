/**
 * ui-pet plugin halves: the browser entry's dictionary and shell.overlay
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the inert node entry, and the invariant companion's
 * ownership reservation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as PetInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'

/** 壳层叠加层当前注册的 entry id 列表。 */
function overlayEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots.entries('shell.overlay').map(entry => entry.options.id)
}

/** 迷你会话服务桩：list 快照 + 无绑定（宠物活跃度源只需这两个面）。 */
function stubSessions(): unknown {
  return {
    list: {
      getSnapshot: () => ({ current: undefined, byId: {} }),
      subscribe: () => () => {},
    },
    binding: () => undefined,
  }
}

/** Boot the browser half over a real slot tree that declares shell.overlay. */
async function benchBench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  ctx.provide('sessions', stubSessions())
  // locale 插件的绑定依赖（与 ui-jobs 同款桩）：connection/remote/settingsScope
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-pet browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['sessions', 'slots', 'locale'])
  })

  it('registers the overlay entry, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await benchBench()
    expect(overlayEntryIds(ctx)).toContain('pet')
    await fiber.dispose()
    expect(overlayEntryIds(ctx)).not.toContain('pet')
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await benchBench()
    const translate = ctx.locale.bind(NS)
    expect(translate('bubble.waiting')).toBe(zh['bubble.waiting'])
    ctx.locale.setLocale('en')
    expect(translate('bubble.waiting')).toBe(en['bubble.waiting'])
    await fiber.dispose()
    expect(translate('bubble.waiting')).not.toBe(en['bubble.waiting'])
  })

  it('binds the petActivity observable through the inject compartment', async () => {
    const { ctx, fiber } = await benchBench()
    const entry = ctx.slots.entries('shell.overlay')[0]
    expect(entry?.options.id).toBe('pet')
    expect(entry?.locale).toBe('pet')
    expect(entry?.inject).toBeTypeOf('function')
    interface InjectedFace { hooks: { petActivity: { getSnapshot: () => unknown; subscribe: (fn: () => void) => () => void } } }
    const face = (entry!.inject as unknown as () => InjectedFace)()
    expect(face.hooks.petActivity.getSnapshot()).toEqual({ state: 'idle' })
    const off = face.hooks.petActivity.subscribe(() => {})
    off()
    await fiber.dispose()
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-pet node half', () => {
  it('contributes no host behavior', () => {
    expect(applyNode).not.toThrow()
  })
})

describe('ui-pet invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(PetInvariant)
    await fiber.await()
    expect(PetInvariant.name).toBe('client-ui-pet-invariant')
    expect(PetInvariant.inject).toEqual(['invariants'])
    // 发出无关事件证明伴随插件未安装任何审计
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
