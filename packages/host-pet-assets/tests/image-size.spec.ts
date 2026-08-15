/**
 * image-size probes: only the header bytes are read, so fixtures carry a real
 * signature plus dimension fields over zeroed payload — the parser contract is
 * header-only by design.
 */
import { describe, expect, it } from 'vitest'
import { imageSizeFromHeader } from '../src/image-size.ts'

/** Build a PNG header: 8-byte signature, IHDR length/type, then 13 data bytes. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  new DataView(bytes.buffer).setUint32(8, 13) // IHDR 数据长度
  bytes.set([0x49, 0x48, 0x44, 0x52], 12) // 'IHDR'
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

/** Build a WebP RIFF wrapper around the given chunk fourcc and payload. */
function webpHeader(fourcc: string, payload: number[]): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.set([0x52, 0x49, 0x46, 0x46]) // 'RIFF'
  new DataView(bytes.buffer).setUint32(4, 12 + payload.length, true)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8) // 'WEBP'
  for (let i = 0; i < 4; i++) bytes[12 + i] = fourcc.charCodeAt(i)
  new DataView(bytes.buffer).setUint32(16, payload.length, true)
  bytes.set(payload, 20)
  return bytes
}

describe('imageSizeFromHeader', () => {
  it('reads PNG IHDR dimensions', () => {
    expect(imageSizeFromHeader(pngHeader(1536, 1872))).toEqual({ width: 1536, height: 1872 })
  })

  it('reads VP8X canvas dimensions (24-bit little-endian minus one)', () => {
    // 1536x2288: (1535, 2287) as 3-byte LE at payload offsets 4 and 7
    const payload = new Array<number>(10).fill(0)
    const w = 1535, h = 2287
    payload[4] = w & 0xff; payload[5] = (w >> 8) & 0xff; payload[6] = (w >> 16) & 0xff
    payload[7] = h & 0xff; payload[8] = (h >> 8) & 0xff; payload[9] = (h >> 16) & 0xff
    expect(imageSizeFromHeader(webpHeader('VP8X', payload))).toEqual({ width: 1536, height: 2288 })
  })

  it('reads VP8 lossy dimensions (14-bit little-endian)', () => {
    // 帧头起始码 9d 01 2a 位于 payload 偏移 3，宽高紧随其后
    const frame = new Uint8Array(10)
    frame.set([0, 0, 0, 0x9d, 0x01, 0x2a])
    new DataView(frame.buffer).setUint16(6, 1536, true)
    new DataView(frame.buffer).setUint16(8, 1872, true)
    expect(imageSizeFromHeader(webpHeader('VP8 ', [...frame]))).toEqual({ width: 1536, height: 1872 })
  })

  it('reads VP8L lossless dimensions (packed 14-bit fields)', () => {
    // signature 0x2f，随后 4 字节打包：14 位宽减一、14 位高减一
    const w = 1535, h = 1871
    const packed = w | (h << 14)
    const payload = [0x2f, packed & 0xff, (packed >> 8) & 0xff, (packed >> 16) & 0xff, (packed >> 24) & 0xff]
    expect(imageSizeFromHeader(webpHeader('VP8L', payload))).toEqual({ width: 1536, height: 1872 })
  })

  it('rejects a WebP with an unknown chunk layout', () => {
    expect(() => imageSizeFromHeader(webpHeader('ALPH', [0, 0, 0, 0]))).toThrow('unrecognized image format')
  })

  it('rejects a non-image header', () => {
    expect(() => imageSizeFromHeader(new Uint8Array(64))).toThrow('unrecognized image format')
  })

  it('rejects a header too short to probe', () => {
    expect(() => imageSizeFromHeader(new Uint8Array(8))).toThrow('unrecognized image format')
  })
})
