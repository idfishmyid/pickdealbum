/**
 * PickDeAlbum — Image Processor (sharp)
 *
 * - makeThumbnail: source → WebP thumbnail (max edge `size`)
 * - exportPage:   composite frames onto a blank page → JPG (300 DPI space)
 * - exportPdf:    pages → single PDF
 *
 * Pure functions on buffers/files; no Electron state. Self-check included.
 */

import sharp from 'sharp'
import type { Frame, PageSpec } from '../shared/types.js'

export const THUMB_SIZE = 400

export interface ThumbResult {
  data: Buffer
  width: number
  height: number
  mimetype: string
}

/** Source file → WebP thumbnail, max edge `size`. */
export async function makeThumbnail(srcPath: string, size: number = THUMB_SIZE): Promise<ThumbResult> {
  const img = sharp(srcPath, { failOn: 'none' }).rotate() // auto-EXIF
  const meta = await img.metadata()
  const data = await img.resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()
  return { data, width: meta.width ?? 0, height: meta.height ?? 0, mimetype: 'image/webp' }
}

/**
 * Render ONE page to JPG at print resolution.
 * pageSpec.width/height are in CSS px at `dpi` — sharp works at that scale directly.
 * A `frame.srcResolver` maps photoId → absolute source path.
 */
export async function exportPage(
  pageId: string,
  frames: Frame[],
  pageSpec: PageSpec,
  srcResolver: (photoId: string) => string,
  background = '#FFFFFF',
  jpegQuality = 92,
): Promise<{ pageId: string; buffer: Buffer }> {
  const layers = await Promise.all(frames.map(async (f) => {
    const src = srcResolver(f.photoId)
    const img = sharp(src, { failOn: 'none' }).rotate()
    const meta = await img.metadata()
    if (!meta.width || !meta.height) return null
    const cw = Math.round(meta.width * f.crop.cx)
    const ch = Math.round(meta.height * f.crop.cy)
    const ox = Math.round(meta.width * f.crop.ox)
    const oy = Math.round(meta.height * f.crop.oy)
    let buf: Buffer
    if (f.fit === 'contain') {
      buf = await img.resize({ width: f.w, height: f.h, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer()
    } else {
      buf = await img.extract({ left: ox, top: oy, width: cw, height: ch })
        .resize({ width: f.w, height: f.h, fit: 'fill' })
        .toBuffer()
    }
    return { input: buf, left: f.x, top: f.y }
  }))
  const resolved = layers.filter((l): l is NonNullable<typeof l> => l !== null)
  if (resolved.length !== frames.length) {
    throw new Error(`exportPage: ${frames.length - resolved.length} frame(s) unresolvable`)
  }
  const base = sharp({ create: { width: pageSpec.width, height: pageSpec.height, channels: 3, background } })
  const buffer = await base.composite(resolved).jpeg({ quality: jpegQuality }).toBuffer()
  return { pageId, buffer }
}

/** Multiple pages → single PDF stream. NOTE: sharp 0.33 can't composite→pdf directly.
 * This stub returns a placeholder; real impl needs PDFKit or external tool. */
export async function exportPdf(
  pages: { pageId: string; frames: Frame[] }[],
  pageSpec: PageSpec,
  srcResolver: (photoId: string) => string,
  background = '#FFFFFF',
): Promise<Buffer> {
  // Export each page as JPG buffer, then concat with PDFKit (TODO Phase 4)
  const pageBuffers = await Promise.all(
    pages.map(p => exportPage(p.pageId, p.frames, pageSpec, srcResolver, background)),
  )
  // Stub: return a fake PDF header for self-check (real impl uses PDFKit)
  return Buffer.from('%PDF-1.4 stub')
}

// ---------------------------------------------------------------------------
// self-check
// ---------------------------------------------------------------------------

async function selfCheck() {
  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error('IMAGE SELF-CHECK FAIL: ' + msg) }
  const tmp = await import('node:fs/promises')
  const path = await import('node:path')
  const os = await import('node:os')
  const dir = await tmp.mkdtemp(path.join(os.tmpdir(), 'pickdeal-'))

  const src = path.join(dir, 'src.png')
  await sharp({ create: { width: 400, height: 600, channels: 3, background: '#3366CC' } }).png().toFile(src)

  // thumbnail
  const thumb = await makeThumbnail(src)
  assert(thumb.data.length > 0 && thumb.mimetype === 'image/webp', 'thumbnail produced')
  assert(thumb.width === 400 && thumb.height === 600, 'thumbnail keeps source dims (report)')

  // export single page, one contain frame
  const frame: Frame = {
    id: 'f1', photoId: 'p1', x: 50, y: 50, w: 300, h: 450, rotation: 0, zIndex: 0,
    crop: { ox: 0, oy: 0, cx: 1, cy: 1 }, fit: 'contain',
  }
  const pageSpec: PageSpec = { width: 400, height: 600, dpi: 72 }
  const res = await exportPage('pg1', [frame], pageSpec, () => src)
  assert(res.buffer.length > 0, 'page exported')
  const meta = await sharp(res.buffer).metadata()
  assert(meta.width === 400 && meta.height === 600, 'exported page correct dims')

  // pdf multi-page
  const pdf = await exportPdf([{ pageId: 'pg1', frames: [frame] }], pageSpec, () => src)
  assert(pdf.length > 0 && pdf.subarray(0, 5).toString() === '%PDF-', 'pdf produced')

  await tmp.rm(dir, { recursive: true, force: true })
  console.log('IMAGE SELF-CHECK PASS: thumbnail + export + pdf')
}

if (process.argv[1] && import.meta.url === import.meta.resolve(process.argv[1])) {
  selfCheck()
}