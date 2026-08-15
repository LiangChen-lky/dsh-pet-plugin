/**
 * Companion-pet plugin, browser half: one PetOverlay entry in the
 * ui-layout-declared 'shell.overlay' list slot, the petActivity observable in
 * the inject hooks compartment, and the pet dictionaries. The overlay reads
 * the current session through the sessions object layer; no RPC of its own.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { createPetActivitySource } from './activity.ts'
import { en, NS, zh, type PetKey } from './locales.ts'
import { PetOverlay, type PetOverlayProps } from './PetOverlay.tsx'
import { createPetStore } from './store.ts'

export type { PetActivity, PetCatalog, PetCatalogEntry } from './contract/types.ts'
export type { PetOverlayProps }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The pet overlay and picker copy. */
    'pet': PetKey
  }
}

/** Required services: sessions object layer, slot registry, copy seat. */
export const inject = ['sessions', 'slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the overlay entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-pet: dictionaries')

  // 当前会话活跃度：list 选择 + 登台会话快照的组合源（引用稳定，见 activity.ts）
  const petActivity = createPetActivitySource(ctx.sessions)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    {
      name: 'shell.overlay',
      id: 'pet',
      store: createPetStore,
      locale: NS,
      inject: () => ({ hooks: { petActivity } }),
    },
    PetOverlay,
  ))
}
