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
  format: 'jpg' | 'png' = 'jpg',
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
      // letterbox with page background color; JPG has no alpha so solid bg
      const bg = /^#[0-9a-f]{6}$/i.test(background) ? background : '#FFFFFF'
      buf = await img.resize({ width: f.w, height: f.h, fit: 'contain', background: bg }).toBuffer()
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
  const composed = base.composite(resolved)
  const buffer = format === 'png'
    ? await composed.png().toBuffer()
    : await composed.jpeg({ quality: jpegQuality }).toBuffer()
  return { pageId, buffer }
}

/** Multiple pages → single PDF stream (PDFKit). One page per PDF page. */
export async function exportPdf(
  pages: { pageId: string; frames: Frame[] }[],
  pageSpec: PageSpec,
  srcResolver: (photoId: string) => string,
  background = '#FFFFFF',
): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default
  const doc = new PDFDocument({
    size: [pageSpec.width, pageSpec.height],
    margin: 0, autoFirstPage: false,
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  for (const p of pages) {
    doc.addPage()
    if (background && /^#[0-9a-f]{6}$/i.test(background)) {
      doc.rect(0, 0, pageSpec.width, pageSpec.height).fill(background)
    }
    // composite each frame onto the PDF page
    for (const f of p.frames) {
      const src = srcResolver(f.photoId)
      const img = sharp(src, { failOn: 'none' }).rotate()
      const meta = await img.metadata()
      if (!meta.width || !meta.height) continue
      const buf = await img.resize({ width: f.w, height: f.h, fit: 'fill' }).toBuffer()
      try { doc.image(buf, f.x, f.y, { width: f.w, height: f.h }) } catch { /* skip */ }
    }
  }
  doc.end()
  return done
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

const isDirect = process.argv[1]?.includes('image-processor.ts') || process.argv[1]?.includes('image-processor.js')
if (isDirect) selfCheck()