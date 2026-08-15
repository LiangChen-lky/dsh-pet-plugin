/**
 * @deepseek-ai/dsh-host-pet-assets — Codex-format pet assets over HTTP:
 * scans the configured pets directory at activation (Codex contract
 * validation, fail-loud on broken manifests), then serves the catalog JSON
 * and spritesheet bytes through named webserver routes. The scan is an
 * activation-time snapshot; adding or replacing pets takes effect on the next
 * composition (restart or HMR reload).
 * @module @deepseek-ai/dsh-host-pet-assets
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { scanPets, type ScannedPet } from './catalog.ts'
import type { PetCatalog, PetCatalogEntry } from './types.ts'

export type { PetCatalog, PetCatalogEntry, ScannedPet }
export { scanPets }

/** Stable Cordis plugin name. */
export const name = 'pet-assets'
/** Routes register against the shared HTTP carrier. */
export const inject = ['webServer']

/** Route prefix: the wire contract shared with the browser plugin — both sides must agree, so it stays fixed. */
export const ROUTE_PREFIX = '/pet-assets'

/** Plugin config: where pets live. */
export interface Config {
  /**
   * Pets root directory; '~' expands to the user home. Absent uses the dsh
   * home first (\$DSH_HOME/pets, or ~/.dsh/pets when the variable is unset),
   * falling back to the Codex convention (\$CODEX_HOME/pets, or ~/.codex/pets
   * when the variable is unset). An explicitly configured directory that does
   * not exist fails composition.
   */
  petsDir?: string
}

export const Config: z<Config> = z.object({
  petsDir: z.string(),
})

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
}

/** 默认宠物根候选：优先 dsh home（$DSH_HOME/pets，未设置为 ~/.dsh/pets），回退 Codex 约定目录。 */
function defaultPetsDirs(): string[] {
  return [
    dshHomePath('pets'),
    join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'pets'),
  ]
}

/** 取第一个存在的目录；候选全不存在时返回 null（默认路径缺省按空目录处理）。 */
async function firstExistingDir(dirs: readonly string[]): Promise<string | null> {
  for (const dir of dirs) {
    if (await stat(dir).then(entry => entry.isDirectory(), () => false)) return dir
  }
  return null
}

/** 展开以 ~ 开头的目录为用户主目录下的路径。 */
function expandHome(dir: string): string {
  if (dir === '~') return homedir()
  if (dir.startsWith('~/') || dir.startsWith('~\\')) return join(homedir(), dir.slice(2))
  return dir
}

/** 清单相对路径（可能含嵌套分隔符）转为路由 URL 段。 */
function spriteUrlOf(routePrefix: string, pet: ScannedPet): string {
  const file = pet.spriteFileName.split(/[\\/]/).map(encodeURIComponent).join('/')
  return `${routePrefix}/sprites/${encodeURIComponent(pet.id)}/${file}`
}

/** 扫描结果转为服务端的线格式目录（绝对路径不出进程）。 */
function toWireCatalog(routePrefix: string, pets: ScannedPet[]): PetCatalog {
  return {
    version: 1,
    pets: pets.map((pet): PetCatalogEntry => ({
      id: pet.id,
      displayName: pet.displayName,
      description: pet.description,
      spriteUrl: spriteUrlOf(routePrefix, pet),
      spriteVersion: pet.spriteVersion,
      frame: pet.frame,
      animations: pet.animations,
      mtimeMs: pet.mtimeMs,
    })),
  }
}

/** 共享方法闸门：两条路由都只回答 GET/HEAD。 */
function allowGetHead(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  res.writeHead(405)
  res.end()
  return false
}

/**
 * Mount the plugin: scan, then register the catalog and spritesheet routes.
 * Both registrations ride one effect so fiber disposal releases the routes
 * together (the real-composition spec observes 404s after teardown).
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 * @throws when an explicitly configured petsDir is absent, or any declared
 * pet manifest fails contract validation.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const routePrefix = ROUTE_PREFIX
  const configured = config.petsDir
  const explicit = configured !== undefined
  let petsDir: string | null
  if (explicit) {
    // 显式配置的目录缺失或非目录属于部署错误，响亮失败
    petsDir = expandHome(configured)
    try {
      if (!(await stat(petsDir)).isDirectory()) {
        throw new Error(`pet-assets: petsDir "${petsDir}" is not a directory`)
      }
    } catch (error) {
      throw error instanceof Error && error.message.startsWith('pet-assets:') ? error : new Error(`pet-assets: petsDir "${petsDir}" does not exist`)
    }
  } else {
    // 默认路径取第一个存在的候选；全缺时 petsDir 为 null，按空目录提供
    petsDir = await firstExistingDir(defaultPetsDirs())
  }
  const pets: ScannedPet[] = petsDir === null ? [] : await scanPets(petsDir)

  const catalog = JSON.stringify(toWireCatalog(routePrefix, pets))
  const petsById = new Map(pets.map(pet => [pet.id, pet]))
  // webserver 前缀语义：注册 p 匹配 p 与 p/<anything>，注册值不带尾斜杠
  const spritesRoute = `${routePrefix}/sprites`
  const spritesPrefix = `${spritesRoute}/`

  ctx.effect(() => {
    const disposeCatalog = ctx.webServer.register({
      kind: 'exact',
      path: `${routePrefix}/catalog.json`,
      handler: (req, res) => {
        if (!allowGetHead(req, res)) return
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' })
        res.end(req.method === 'HEAD' ? undefined : catalog)
      },
    })
    const disposeSprites = ctx.webServer.register({
      kind: 'prefix',
      path: spritesRoute,
      handler: async (req, res) => {
        if (!allowGetHead(req, res)) return
        /* v8 ignore next 3 -- node:http always sets url on server requests */
        if (req.url === undefined) throw new Error('pet-assets: request without url')
        /* v8 ignore next -- HTTP/1.1 请求必带 Host 头，该缺省只是类型防线 */
        const { pathname } = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
        const segments = pathname.slice(spritesPrefix.length).split('/').map(decodeURIComponent)
        /* v8 ignore next -- split 恒产出至少一个元素，?? '' 只是 noUncheckedIndexedAccess 防线 */
        const pet = petsById.get(segments[0] ?? '')
        // 只服务清单声明的那一张精灵图：相对路径相等性检查同时挡住穿越段
        const declared = pet?.spriteFileName.split(/[\\/]/).join('/')
        if (pet === undefined || segments.slice(1).join('/') !== declared) {
          res.writeHead(404)
          res.end()
          return
        }
        const body = await readFile(pet.spriteFilePath)
        res.writeHead(200, {
          'content-type': MIME[extname(pet.spriteFilePath)] ?? 'application/octet-stream',
          'cache-control': 'no-cache',
        })
        res.end(req.method === 'HEAD' ? undefined : body)
      },
    })
    return () => {
      disposeCatalog()
      disposeSprites()
    }
  }, 'pet-assets: catalog + spritesheet routes')
}
