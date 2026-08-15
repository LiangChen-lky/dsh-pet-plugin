/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the webserver and pet-assets rows; every assertion
 * observes the served HTTP surface — catalog JSON, spritesheet bytes, unknown
 * pet/traversal 404, 405 on non-GET/HEAD, loud failure on a configured
 * missing directory, and route release on fiber disposal (HMR safety).
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as PetAssets from '../src/index.ts'
import type { PetCatalog } from '../src/types.ts'
// 类型侧拉入 Context 的 loader 增强（entries/update 的类型来源）
import type {} from '@deepseek-ai/cordis-plugin-loader'

let root: string | undefined
let context: Context | undefined
let savedCodexHome: string | undefined
let savedDshHome: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (savedCodexHome === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = savedCodexHome
  savedCodexHome = undefined
  if (savedDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedDshHome
  savedDshHome = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** 在指定宠物根（pets 目录本体）下造一只合法宠物（chefito）。 */
async function writePet(petsRoot: string): Promise<void> {
  await mkdir(join(petsRoot, 'chefito'), { recursive: true })
  await writeFile(join(petsRoot, 'chefito', 'pet.json'), '{"displayName":"Chefito","description":"A tiny chef"}')
  const bytes = new Uint8Array(64)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  new DataView(bytes.buffer).setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  new DataView(bytes.buffer).setUint32(16, 1536)
  new DataView(bytes.buffer).setUint32(20, 1872)
  await writeFile(join(petsRoot, 'chefito', 'spritesheet.webp'), bytes)
}

/** 造宠物夹具（合法头部合成图）+ 两行 cordis.yml，走真 Loader 启动。 */
async function loadComposition(options: { configLine?: string; withPet?: boolean; spriteName?: string } = {}): Promise<{ base: string }> {
  const { configLine, withPet = true, spriteName = 'spritesheet.webp' } = options
  root = await mkdtemp(join(tmpdir(), 'dsh-pet-assets-'))
  const petsDir = join(root, 'pets')
  await mkdir(petsDir)
  if (withPet) {
    const petDir = join(petsDir, 'chefito')
    await mkdir(petDir)
    const manifest = spriteName === 'spritesheet.webp'
      ? '{"displayName":"Chefito","description":"A tiny chef"}'
      : JSON.stringify({ displayName: 'Chefito', spritesheetPath: spriteName })
    await writeFile(join(petDir, 'pet.json'), manifest)
    const bytes = new Uint8Array(64)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    new DataView(bytes.buffer).setUint32(8, 13)
    bytes.set([0x49, 0x48, 0x44, 0x52], 12)
    new DataView(bytes.buffer).setUint32(16, 1536)
    new DataView(bytes.buffer).setUint32(20, 1872)
    await writeFile(join(petDir, spriteName), bytes)
  }
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    '- id: pet-assets',
    "  name: '@deepseek-ai/dsh-host-pet-assets'",
    ...(configLine === undefined ? ['  config:', `    petsDir: ${JSON.stringify(petsDir)}`] : [configLine]),
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-host-pet-assets', PetAssets],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  // create 只提交条目树；各 fiber 的异步激活由 await() 收敛（失败在此抛出）
  await context.loader.await()
  return { base: `http://127.0.0.1:${context.webServer.port}` }
}

describe('pet-assets composition', () => {
  it('serves the scanned catalog with route-relative sprite URLs', async () => {
    const { base } = await loadComposition()
    const res = await fetch(`${base}/pet-assets/catalog.json`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const catalog = await res.json() as PetCatalog
    expect(catalog.version).toBe(1)
    expect(catalog.pets).toHaveLength(1)
    const pet = catalog.pets[0]!
    expect(pet.id).toBe('chefito')
    expect(pet.displayName).toBe('Chefito')
    expect(pet.spriteVersion).toBe(1)
    expect(pet.spriteUrl).toBe('/pet-assets/sprites/chefito/spritesheet.webp')
    expect(pet.animations['idle']!.frames).toHaveLength(6)
  })

  it('serves spritesheet bytes with the image content type', async () => {
    const { base } = await loadComposition()
    const res = await fetch(`${base}/pet-assets/sprites/chefito/spritesheet.webp`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    const body = new Uint8Array(await res.arrayBuffer())
    expect(body.length).toBe(64)
    expect(body[0]).toBe(0x89)
  })

  it('answers HEAD with headers only', async () => {
    const { base } = await loadComposition()
    const res = await fetch(`${base}/pet-assets/sprites/chefito/spritesheet.webp`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(await res.text()).toBe('')
  })

  it('404s unknown pets and undeclared files inside a pet directory', async () => {
    const { base } = await loadComposition()
    expect((await fetch(`${base}/pet-assets/sprites/ghost/spritesheet.webp`)).status).toBe(404)
    // 目录里真实存在但未声明的文件同样不服务
    expect((await fetch(`${base}/pet-assets/sprites/chefito/pet.json`)).status).toBe(404)
    // 编码穿越段不得逃逸
    expect((await fetch(`${base}/pet-assets/sprites/chefito/..%2F..%2Fpet-assets%2Fpets%2Fchefito%2Fpet.json`)).status).toBe(404)
  })

  it('405s non-GET/HEAD methods on both routes', async () => {
    const { base } = await loadComposition()
    expect((await fetch(`${base}/pet-assets/catalog.json`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/pet-assets/sprites/chefito/spritesheet.webp`, { method: 'POST' })).status).toBe(405)
  })

  it('answers HEAD on the catalog with headers only', async () => {
    const { base } = await loadComposition()
    const res = await fetch(`${base}/pet-assets/catalog.json`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.text()).toBe('')
  })

  it('serves a sprite with an unknown extension as octet-stream', async () => {
    // 精灵图以 .gif 命名（内容仍是合法 PNG 头，尺寸校验看内容不看扩展名）
    const { base } = await loadComposition({ spriteName: 'sheet.gif' })
    const res = await fetch(`${base}/pet-assets/sprites/chefito/sheet.gif`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
  })

  it('fails loudly when the configured petsDir is a file', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pet-assets-file-'))
    const filePath = join(root, 'a-file')
    await writeFile(filePath, 'x')
    await expect(loadComposition({ configLine: ['  config:', `    petsDir: ${JSON.stringify(filePath)}`].join('\n'), withPet: false }))
      .rejects.toThrow('is not a directory')
  })

  it('expands ~ prefixes in a configured petsDir', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pet-assets-tilde-'))
    await expect(loadComposition({ configLine: ['  config:', '    petsDir: "~/.dsh-test-nonexistent-pets"'].join('\n'), withPet: false }))
      .rejects.toThrow('does not exist')
    await expect(loadComposition({ configLine: ['  config:', '    petsDir: "~\\\\.dsh-test-nonexistent-pets"'].join('\n'), withPet: false }))
      .rejects.toThrow('does not exist')
  })

  it('serves an empty catalog from an existing but empty dsh-home pets root', async () => {
    savedCodexHome = process.env.CODEX_HOME
    savedDshHome = process.env.DSH_HOME
    root = await mkdtemp(join(tmpdir(), 'dsh-pet-assets-home-'))
    // 主根 = $DSH_HOME/pets 存在但为空：扫描它；即便 Codex 根有宠物也以主根为准
    await mkdir(join(root, 'pets'))
    await writePet(join(root, 'codex', 'pets'))
    process.env.DSH_HOME = root
    process.env.CODEX_HOME = join(root, 'codex')
    const { base } = await loadComposition({ configLine: '', withPet: false })
    const res = await fetch(`${base}/pet-assets/catalog.json`)
    expect(res.status).toBe(200)
    expect((await res.json() as PetCatalog).pets).toEqual([])
  })

  it('falls back to the Codex pets root when the dsh-home pets path is absent', async () => {
    savedCodexHome = process.env.CODEX_HOME
    savedDshHome = process.env.DSH_HOME
    root = await mkdtemp(join(tmpdir(), 'dsh-pet-assets-fallback-'))
    // 主根缺失 → 回退到 $CODEX_HOME/pets，其中的宠物照常提供
    await writePet(join(root, 'codex', 'pets'))
    process.env.DSH_HOME = join(root, 'no-dsh-home')
    process.env.CODEX_HOME = join(root, 'codex')
    const { base } = await loadComposition({ configLine: '', withPet: false })
    const res = await fetch(`${base}/pet-assets/catalog.json`)
    expect(res.status).toBe(200)
    expect((await res.json() as PetCatalog).pets.map(p => p.id)).toEqual(['chefito'])
  })

  it('falls back to the Codex pets root when the dsh-home pets path is a file', async () => {
    savedCodexHome = process.env.CODEX_HOME
    savedDshHome = process.env.DSH_HOME
    root = await mkdtemp(join(tmpdir(), 'dsh-pet-assets-file-fallback-'))
    const dshHome = join(root, 'home')
    await mkdir(dshHome)
    // $DSH_HOME/pets 是文件（非目录）：不算候选，继续回退 Codex 根
    await writeFile(join(dshHome, 'pets'), 'not a dir')
    await writePet(join(root, 'codex', 'pets'))
    process.env.DSH_HOME = dshHome
    process.env.CODEX_HOME = join(root, 'codex')
    const { base } = await loadComposition({ configLine: '', withPet: false })
    const res = await fetch(`${base}/pet-assets/catalog.json`)
    expect(res.status).toBe(200)
    expect((await res.json() as PetCatalog).pets.map(p => p.id)).toEqual(['chefito'])
  })

  it('serves an empty catalog when both default roots are absent', async () => {
    savedCodexHome = process.env.CODEX_HOME
    savedDshHome = process.env.DSH_HOME
    root = await mkdtemp(join(tmpdir(), 'dsh-pet-assets-empty-'))
    // 默认路径全缺（DSH_HOME 与 CODEX_HOME 都指向不存在的根）不失败，按空目录提供
    process.env.DSH_HOME = join(root, 'no-dsh-home')
    process.env.CODEX_HOME = join(root, 'no-pets-here')
    const { base } = await loadComposition({ configLine: '', withPet: false })
    const res = await fetch(`${base}/pet-assets/catalog.json`)
    expect(res.status).toBe(200)
    expect((await res.json() as PetCatalog).pets).toEqual([])
  })

  it('serves a catalog when neither petsDir nor DSH_HOME/CODEX_HOME is set', async () => {
    savedCodexHome = process.env.CODEX_HOME
    savedDshHome = process.env.DSH_HOME
    delete process.env.CODEX_HOME
    delete process.env.DSH_HOME
    // 默认根存在与否取决于机器（本机 ~/.codex/pets 有真实宠物；CI 无）：只断言服务可用
    const { base } = await loadComposition({ configLine: '', withPet: false })
    const res = await fetch(`${base}/pet-assets/catalog.json`)
    expect(res.status).toBe(200)
    expect((await res.json() as PetCatalog).version).toBe(1)
  })

  it('accepts a bare ~ as the user home', async () => {
    // 主目录恒存在：扫描它（其子目录通常无清单 → 空目录）
    const { base } = await loadComposition({ configLine: ['  config:', '    petsDir: "~"'].join('\n'), withPet: false })
    const res = await fetch(`${base}/pet-assets/catalog.json`)
    expect(res.status).toBe(200)
  })

  it('fails composition loudly when a configured petsDir is missing', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pet-assets-missing-'))
    await expect(loadComposition({ configLine: ['  config:', `    petsDir: ${JSON.stringify(join(root, 'gone'))}`].join('\n'), withPet: false }))
      .rejects.toThrow(/petsDir.*does not exist|pet-assets/)
  })

  it('releases both routes on fiber disposal (HMR safety)', async () => {
    const { base } = await loadComposition()
    expect((await fetch(`${base}/pet-assets/catalog.json`)).status).toBe(200)
    // 禁用条目走 Loader 部分卸载：fiber 处置必须摘掉本插件的两条路由
    const entry = [...context!.loader.entries()].find(e => e.options.name === '@deepseek-ai/dsh-host-pet-assets')
    await entry?.update({ disabled: true })
    expect((await fetch(`${base}/pet-assets/catalog.json`)).status).toBe(404)
    expect((await fetch(`${base}/pet-assets/sprites/chefito/spritesheet.webp`)).status).toBe(404)
  })
})
