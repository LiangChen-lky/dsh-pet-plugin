/**
 * Package-owned invariant companion for `@kkkey/dsh-pet-assets`.
 * @module @kkkey/dsh-pet-assets/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@kkkey/dsh-pet-assets'

/** Cordis companion plugin name. */
export const name = 'host-pet-assets-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the owned relations are two named webserver routes,
 * and 'internal/plugin' fires before the disposing fiber's effects run, so a
 * teardown-time probe would still see the legitimate registration and
 * false-positive on every correct disposal. Register/release symmetry is
 * covered by the package's real-composition HMR-safety test instead.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
