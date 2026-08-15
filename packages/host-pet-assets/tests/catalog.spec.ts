/**
 * Catalog scan/validation matrix. Semantics mirror the Codex pet contract
 * (codex-rs/tui/src/pets/model.rs): default frame grid, exact-cover rule,
 * animation resolution with fps/loop/fallback defaults, and path containment.
 * Image fixtures carry real headers over zeroed payloads (header-only probe).
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanPets } from '../src/catalog.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** 写一张只有头部的合成精灵图（目录扫描只读头部尺寸）。 */
async function writeSpritesheet(dir: string, name: string, width: number, height: number): Promise<void> {
  const bytes = new Uint8Array(64)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  new DataView(bytes.buffer).setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  await writeFile(join(dir, name), bytes)
}

/** 建一只宠物目录：pet.json + 指定尺寸的精灵图，返回宠物目录路径。 */
async function writePet(
  id: string, manifest: string, dims: { width: number; height: number } = { width: 1536, height: 1872 },
): Promise<string> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-pet-catalog-'))
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'pet.json'), manifest)
  await writeSpritesheet(dir, 'spritesheet.webp', dims.width, dims.height)
  return dir
}

const MINIMAL = '{"id":"chefito","displayName":"Chefito","description":"A tiny recipe-loving chef"}'

describe('scanPets', () => {
  it('loads a minimal manifest with contract defaults', async () => {
    await writePet('chefito', MINIMAL)
    const pets = await scanPets(root!)
    expect(pets).toHaveLength(1)
    const pet = pets[0]!
    expect(pet.id).toBe('chefito')
    expect(pet.displayName).toBe('Chefito')
    expect(pet.description).toBe('A tiny recipe-loving chef')
    expect(pet.spriteVersion).toBe(1)
    expect(pet.frame).toEqual({ width: 192, height: 208, columns: 8, rows: 9 })
    expect(pet.spriteFileName).toBe('spritesheet.webp')
    expect(pet.mtimeMs).toBeGreaterThan(0)
    // 默认 idle：环境慢速循环（基础时长 x6）
    const idle = pet.animations['idle']!
    expect(idle.frames.map(f => f.spriteIndex)).toEqual([0, 1, 2, 3, 4, 5])
    expect(idle.frames.map(f => f.durationMs)).toEqual([1680, 660, 660, 840, 840, 1920])
    expect(idle.loopStart).toBe(0)
  })

  it('repeats a state animation three times then settles into idle', async () => {
    await writePet('chefito', MINIMAL)
    const [pet] = await scanPets(root!)
    const running = pet!.animations['running']!
    const primary = [56, 57, 58, 59, 60, 61]
    expect(running.frames.slice(0, 6).map(f => f.spriteIndex)).toEqual(primary)
    expect(running.frames.slice(6, 12).map(f => f.spriteIndex)).toEqual(primary)
    expect(running.frames.slice(12, 18).map(f => f.spriteIndex)).toEqual(primary)
    expect(running.frames.slice(18).map(f => f.spriteIndex)).toEqual([0, 1, 2, 3, 4, 5])
    expect(running.frames.slice(0, 6).map(f => f.durationMs)).toEqual([120, 120, 120, 120, 120, 220])
    expect(running.loopStart).toBe(18)
    expect(running.fallback).toBe('idle')
  })

  it('maps notification states to their contract rows', async () => {
    await writePet('chefito', MINIMAL)
    const [pet] = await scanPets(root!)
    expect(pet!.animations['waiting']!.frames.slice(0, 6).map(f => f.spriteIndex)).toEqual([48, 49, 50, 51, 52, 53])
    expect(pet!.animations['review']!.frames.slice(0, 6).map(f => f.spriteIndex)).toEqual([64, 65, 66, 67, 68, 69])
    expect(pet!.animations['failed']!.frames.slice(0, 8).map(f => f.spriteIndex)).toEqual([40, 41, 42, 43, 44, 45, 46, 47])
    // TUI 别名同帧复刻
    expect(pet!.animations['sad']!.frames.slice(0, 8).map(f => f.spriteIndex)).toEqual([40, 41, 42, 43, 44, 45, 46, 47])
    expect(pet!.animations['move_right']!.frames.slice(0, 8).map(f => f.spriteIndex)).toEqual([8, 9, 10, 11, 12, 13, 14, 15])
  })

  it('detects the v2 look-ring spritesheet by dimensions', async () => {
    await writePet('tall', MINIMAL, { width: 1536, height: 2288 })
    const [pet] = await scanPets(root!)
    expect(pet!.spriteVersion).toBe(2)
    expect(pet!.frame.rows).toBe(11)
  })

  it('rejects a spritesheet outside both contract sizes', async () => {
    await writePet('odd', MINIMAL, { width: 1024, height: 1024 })
    await expect(scanPets(root!)).rejects.toThrow('pet "odd": spritesheet must be 1536x1872 or 1536x2288 pixels, got 1024x1024')
  })

  it('reports a corrupt spritesheet as a read error, not a missing file', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pet-catalog-'))
    const dir = join(root, 'corrupt')
    await mkdir(dir)
    await writeFile(join(dir, 'pet.json'), MINIMAL)
    await writeFile(join(dir, 'spritesheet.webp'), new Uint8Array(64))
    await expect(scanPets(root)).rejects.toThrow(/pet "corrupt": read .*: unrecognized image format/)
  })

  it('rejects a missing spritesheet', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pet-catalog-'))
    const dir = join(root, 'empty')
    await mkdir(dir)
    await writeFile(join(dir, 'pet.json'), MINIMAL)
    await expect(scanPets(root)).rejects.toThrow('missing spritesheet')
  })

  it('rejects a frame grid that does not cover the spritesheet', async () => {
    await writePet('short', '{"displayName":"Short","frame":{"width":192,"height":208,"columns":7,"rows":9}}')
    await expect(scanPets(root!)).rejects.toThrow('pet "short": pet frame grid must cover spritesheet exactly: expected 1536x1872, got 1344x1872')
  })

  it('rejects zero frame dimensions', async () => {
    await writePet('zero', '{"frame":{"width":0,"height":208,"columns":8,"rows":9}}')
    await expect(scanPets(root!)).rejects.toThrow('pet frame dimensions and grid counts must be non-zero')
  })

  it('rejects frame counts above the contract maximum', async () => {
    // 8x8 单元铺满 1536x1872 → 192x234 = 44928 帧，远超上限
    await writePet('dense', '{"frame":{"width":8,"height":8,"columns":192,"rows":234}}')
    await expect(scanPets(root!)).rejects.toThrow('exceeds maximum 256')
  })

  it('rejects an animation missing the frames key', async () => {
    await writePet('noframes', '{"animations":{"idle":{"fps":4}}}')
    await expect(scanPets(root!)).rejects.toThrow('animation idle must include at least one frame')
  })

  it('rejects an animation without frames', async () => {
    await writePet('empty', '{"animations":{"idle":{"frames":[]}}}')
    await expect(scanPets(root!)).rejects.toThrow('animation idle must include at least one frame')
  })

  it('rejects an animation frame outside the grid', async () => {
    await writePet('outside', '{"animations":{"idle":{"frames":[72]}}}')
    await expect(scanPets(root!)).rejects.toThrow('animation idle references sprite index 72, but pet has 72 frames')
  })

  it('rejects a non-finite or out-of-range fps', async () => {
    await writePet('fast', '{"animations":{"idle":{"frames":[0],"fps":120}}}')
    await expect(scanPets(root!)).rejects.toThrow('animation idle fps must be finite and between 0 and 60, got 120')
  })

  it('resolves custom animation defaults: 8fps, loop, idle fallback', async () => {
    await writePet('custom', '{"animations":{"trick":{"frames":[1,2]}}}')
    const [pet] = await scanPets(root!)
    const trick = pet!.animations['trick']!
    expect(trick.frames).toEqual([
      { spriteIndex: 1, durationMs: 125 },
      { spriteIndex: 2, durationMs: 125 },
    ])
    expect(trick.loopStart).toBe(0)
    expect(trick.fallback).toBe('idle')
  })

  it('keeps a manifest one-shot animation shape', async () => {
    await writePet('oneshot', '{"animations":{"trick":{"frames":[1,2],"fps":2,"loop":false}}}')
    const [pet] = await scanPets(root!)
    const trick = pet!.animations['trick']!
    expect(trick.frames.map(f => f.durationMs)).toEqual([500, 500])
    expect(trick.loopStart).toBeNull()
  })

  it('rejects a fallback naming a missing animation', async () => {
    await writePet('fallback', '{"animations":{"wave":{"frames":[1],"loop":false,"fallback":"missing"}}}')
    await expect(scanPets(root!)).rejects.toThrow('animation wave fallback missing does not exist')
  })

  it('rejects a spritesheet path escaping the pet directory', async () => {
    await writePet('escape', '{"spritesheetPath":"../spritesheet.webp"}')
    await expect(scanPets(root!)).rejects.toThrow('spritesheet path must stay inside')
  })

  it('falls back to the legacy avatar.json manifest', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pet-catalog-'))
    const dir = join(root, 'legacy')
    await mkdir(dir)
    await writeFile(join(dir, 'avatar.json'), '{"displayName":"Legacy"}')
    await writeSpritesheet(dir, 'spritesheet.webp', 1536, 1872)
    const [pet] = await scanPets(root)
    expect(pet!.id).toBe('legacy')
    expect(pet!.displayName).toBe('Legacy')
  })

  it('skips directories without any manifest and non-directory entries', async () => {
    await writePet('chefito', MINIMAL)
    await mkdir(join(root!, 'stray'))
    await writeFile(join(root!, 'loose.txt'), 'x')
    const pets = await scanPets(root!)
    expect(pets.map(p => p.id)).toEqual(['chefito'])
  })

  it('derives displayName from id then directory name', async () => {
    await writePet('bare', '{}')
    const [pet] = await scanPets(root!)
    expect(pet!.displayName).toBe('bare')
  })

  it('treats an empty-string fallback as the idle default', async () => {
    await writePet('blankfb', '{"animations":{"trick":{"frames":[1],"loop":false,"fallback":""}}}')
    const [pet] = await scanPets(root!)
    expect(pet!.animations['trick']!.fallback).toBe('idle')
  })

  it('derives displayName from the manifest id when displayName is blank', async () => {
    await writePet('named', '{"id":"inner-name"}')
    const [pet] = await scanPets(root!)
    expect(pet!.displayName).toBe('inner-name')
  })

  it('rejects a tiny custom grid whose default table indices overflow', async () => {
    // 1x1 网格恰好铺满整图（合法），但默认动画引用行 1+ 的索引必然越界
    await writePet('tiny', '{"frame":{"width":1536,"height":1872,"columns":1,"rows":1}}')
    await expect(scanPets(root!)).rejects.toThrow('animation idle references sprite index 1, but pet has 1 frames')
  })

  it('rejects malformed manifest JSON', async () => {
    await writePet('broken', '{oops')
    await expect(scanPets(root!)).rejects.toThrow(/pet "broken": parse .*pet.json/)
  })
})
