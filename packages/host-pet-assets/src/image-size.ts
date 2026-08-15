/**
 * Header-only image dimension probe for the pet spritesheet contract. The
 * catalog validates dimensions at scan time, so reading whole multi-megabyte
 * sheets just to reach the size fields would be waste; PNG IHDR and the three
 * WebP chunk layouts all carry dimensions inside the first 64 bytes. All reads
 * go through DataView so out-of-range input surfaces as a RangeError instead
 * of an undefined-index assertion.
 */

/** Image dimensions in pixels. */
export interface ImageSize {
  /** Pixel width. */
  width: number
  /** Pixel height in pixels. */
  height: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function ascii(view: DataView, offset: number, length: number): string {
  let text = ''
  for (let index = 0; index < length; index++) text += String.fromCharCode(view.getUint8(offset + index))
  return text
}

function matches(view: DataView, expected: readonly number[]): boolean {
  return expected.every((value, index) => view.byteLength > index && view.getUint8(index) === value)
}

/**
 * Read image dimensions from the leading bytes of a PNG or WebP file.
 * @param header - at least the first 30 bytes of the file.
 * @returns pixel dimensions.
 * @throws on unrecognized or truncated headers.
 */
export function imageSizeFromHeader(header: Uint8Array): ImageSize {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  // PNG 块布局：8 字节签名 + [长度4][类型4][数据...]，IHDR 数据区宽高为两个大端 u32
  if (view.byteLength >= 30 && matches(view, PNG_SIGNATURE) && ascii(view, 12, 4) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (view.byteLength >= 30 && ascii(view, 0, 4) === 'RIFF' && ascii(view, 8, 4) === 'WEBP') {
    const chunk = ascii(view, 12, 4)
    if (chunk === 'VP8X') {
      // 扩展头：画布宽高为 24 位小端存储值加一（数据区偏移 4/7）
      const read24 = (offset: number): number =>
        view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
      return { width: read24(24) + 1, height: read24(27) + 1 }
    }
    if (chunk === 'VP8 ') {
      // 有损帧：3 字节起始码后紧跟 14 位小端宽高
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    }
    if (chunk === 'VP8L') {
      // 无损帧：签名字节后 4 个字节打包 14 位宽、14 位高（均减一存储）
      const packed = view.getUint32(21, true)
      return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 }
    }
  }
  throw new Error('unrecognized image format: expected a PNG or WebP header')
}
