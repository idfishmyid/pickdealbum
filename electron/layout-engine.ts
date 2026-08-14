/**
 * PickDeAlbum — Auto Layout Engine ("PackedFit-1")
 *
 * Pure, stateless layout pipeline. Input photos + page constraints,
 * output positioned frames with normalized (0..1) crops so nothing
 * is cut arbitrarily.
 *
 * Runs in Main process (pure JS, no Electron/sharp deps → directly
 * executable by Node for the self-check).
 *
 * Math units: CSS pixels. 300 DPI print target = same coordinate space.
 */

import type { LayoutInput, LayoutResult, RenderPage, Frame, Photo, Margin } from '../shared/types.js'

// ---------------------------------------------------------------------------
// internal types
// ---------------------------------------------------------------------------

interface Slot {
  x: number
  y: number
  w: number
  h: number
  photoId: string
  photoRatio: number // w / h of source photo (after EXIF normalize)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const makeIdGen = (prefix: string) => {
  let n = 0
  return () => `${prefix}${(n++).toString(36)}`
}
const pgId = makeIdGen('pg'), frId = makeIdGen('fr')

const EPS = 1e-6

/** Aspect ratio w/h, EXIF-normalized (treat 90° rotations as swapped dims). */
function ratio(p: Photo): number {
  const orient = p.orientation ?? 1
  const swapped = [5, 6, 7, 8].includes(orient)
  const w = swapped ? p.height : p.width
  const h = swapped ? p.width : p.height
  return w / Math.max(1, h)
}

/** Normalized full-frame crop (show entire photo). */
const FULL_CROP = { ox: 0, oy: 0, cx: 1, cy: 1 }

/**
 * Minimal "cover" crop: keep the middle strip (rule-of-thirds bias toward
 * center), normalized 0..1, so the photo fills frame w×h exactly.
 */
function coverCrop(photo: Photo, fw: number, fh: number): Frame['crop'] {
  const orient = photo.orientation ?? 1
  const swapped = [5, 6, 7, 8].includes(orient)
  const sw = swapped ? photo.height : photo.width
  const sh = swapped ? photo.width : photo.height
  const frameR = fw / fh
  const photoR = sw / sh
  let cropW: number, cropH: number
  if (photoR > frameR) {
    cropW = sh * frameR   // photo wider → crop width
    cropH = sh
  } else {
    cropW = sw
    cropH = sw / frameR   // photo taller → crop height
  }
  return { ox: (sw - cropW) / 2 / sw, oy: (sh - cropH) / 2 / sh, cx: cropW / sw, cy: cropH / sh }
}

// ---------------------------------------------------------------------------
// core pipeline
// ---------------------------------------------------------------------------

export function computeLayout(input: LayoutInput): LayoutResult {
  const {
    photos, pageSpec, margins, gap,
    fitMode = 'contain', preferGrid = 'auto', autoBalance = true,
  } = input

  const warnings: LayoutResult['warnings'] = []
  const W = pageSpec.width, H = pageSpec.height
  const m: Margin = margins
  const contentW = W - m.left - m.right
  const contentH = H - m.top - m.bottom
  if (contentW <= 0 || contentH <= 0) throw new Error('layout: margins exceed page')

  if (photos.length === 0) return { pages: [], warnings: [] }

  const ps = photos.map(p => ({ p, r: ratio(p) }))

  // choose grid per page from dominant ratio
  const gridFor = (rs: number[]): { cols: number; rows: number } => {
    if (preferGrid === 'single') return { cols: 1, rows: 1 }
    if (preferGrid === 'two-up') return { cols: 2, rows: 1 }
    if (preferGrid === 'four-up') return { cols: 2, rows: 2 }
    const med = rs.slice().sort((a, b) => a - b)[rs.length >> 1]
    return med > 1.25 ? { cols: 2, rows: 2 } : { cols: 1, rows: 2 }
  }

  // Packer: for 'contain' keep photo ratio; for 'cover' fit into fixed grid cell ratio.
  // cellRatio = cols > 1 ? 2/1 (landscape cell) : 1/2 (portrait cell) for simple 2-row grid.
  const cellRatio = fitMode === 'cover' ? (contentW / (contentH / 2)) : null // null = use photo ratio

  function packRow(pool: { p: Photo; r: number }[]): { frames: Slot[]; used: number } {
    const frames: Slot[] = []
    let x = 0
    let used = 0
    const rowH = contentH / 2 - gap / 2
    const targetR = cellRatio ?? 1.5 // fallback
    while (used < pool.length) {
      const photo = pool[used]
      const r = cellRatio ?? photo.r
      const fw = rowH * r
      if (x > 0 && x + fw > contentW + EPS) break
      if (x + fw > contentW + EPS && frames.length === 0) {
        const s = contentW / fw
        frames.push({ x: m.left, y: m.top, w: contentW, h: rowH * s, photoId: photo.p.id, photoRatio: photo.r })
      } else {
        frames.push({ x: m.left + x, y: m.top, w: fw, h: rowH, photoId: photo.p.id, photoRatio: photo.r })
      }
      x += fw + gap
      used++
      if (frames.length >= 4) break
    }
    return { frames, used }
  }

  const pages: RenderPage[] = []
  let i = 0
  while (i < ps.length) {
    const { frames, used } = packRow(ps.slice(i))
    if (frames.length === 0) {
      const photo = ps[i]
      const fw = contentW, fh = fw / photo.r
      frames.push({ x: m.left, y: m.top, w: fw, h: fh, photoId: photo.p.id, photoRatio: photo.r })
    }
    if (used < ps.length - i) warnings.push({ pageId: 'pg:' + pages.length, message: 'photos deferred to next page (no-crop)' })
    const pageFrames: Frame[] = frames.map(f => {
      const photo = photos.find(ph => ph.id === f.photoId)!
      let crop = FULL_CROP
      // cover: frame keeps grid-cell ratio; photo is cropped (minimal, centered) to fill it
      if (fitMode === 'cover') {
        crop = coverCrop(photo, f.w, f.h)
      }
      return {
        id: frId(), photoId: f.photoId,
        x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h),
        rotation: 0, zIndex: 0, crop, fit: fitMode,
      }
    })
    pages.push({ id: pgId(), frames: pageFrames })
    i += frames.length
  }

  // balance: if last page is sparse, fold frames back into previous page
  if (autoBalance && pages.length > 1) {
    const last = pages[pages.length - 1]
    const prev = pages[pages.length - 2]
    if (last.frames.length <= 2 && prev.frames.length < 4) {
      prev.frames.push(...last.frames)
      pages.pop()
    }
  }

  return { pages, warnings }
}

// ---------------------------------------------------------------------------
// self-check — runnable without any dependency: node electron/layout-engine.ts
// ---------------------------------------------------------------------------

function selfCheck() {
  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error('SELF-CHECK FAIL: ' + msg) }

  // 1) mixed ratios, contain, no-crop
  const photos = [
    { id: 'a', width: 3000, height: 4500 },   // 0.667 portrait
    { id: 'b', width: 4500, height: 3000 },   // 1.5   landscape
    { id: 'c', width: 2000, height: 2000 },   // 1.0   square
    { id: 'd', width: 3000, height: 4500 },
    { id: 'e', width: 4500, height: 3000 },
  ]
  const r1 = computeLayout({
    photos, pageSpec: { width: 3035, height: 4054, dpi: 300 },
    margins: { top: 120, right: 120, bottom: 120, left: 120 },
    gap: 20, fitMode: 'contain', noCropPolicy: true,
  })
  const total = r1.pages.reduce((a, p) => a + p.frames.length, 0)
  assert(total === 5, `all 5 photos placed (got ${total})`)
  const ratioOf = Object.fromEntries(photos.map(p => [p.id, p.width / p.height]))
  for (const p of r1.pages) for (const f of p.frames) {
    assert(f.x >= 0 && f.y >= 0 && f.x + f.w <= 3035 + 1 && f.y + f.h <= 4054 + 1, `frame ${f.id} in-bounds`)
    assert(f.crop.cx === 1 && f.crop.cy === 1 && f.crop.ox === 0 && f.crop.oy === 0, 'contain ⇒ full crop')
    assert(Math.abs(f.w / f.h - ratioOf[f.photoId]) / ratioOf[f.photoId] < 0.01, `frame ${f.id} keeps photo ratio (±1% after rounding)`)
  }

  // 2) cover mode crops only the long axis, centered
  const r2 = computeLayout({
    photos: [{ id: 'x', width: 4500, height: 3000 }], // landscape into portrait frame
    pageSpec: { width: 3035, height: 4054 }, margins: { top: 0, right: 0, bottom: 0, left: 0 }, gap: 0,
    fitMode: 'cover',
  })
  assert(r2.pages.length === 1 && r2.pages[0].frames.length === 1, 'single cover frame')
  const c = r2.pages[0].frames[0].crop
  assert(c.cy === 1 && c.ox > 0 && c.cx < 1, `cover crops width only: ${JSON.stringify(c)}`)

  // 3) zero photos → empty result, no throw
  const r3 = computeLayout({ photos: [], pageSpec: { width: 100, height: 100 }, margins: { top: 0, right: 0, bottom: 0, left: 0 }, gap: 0 })
  assert(r3.pages.length === 0, 'empty input ⇒ empty result')

  // 4) margins exceed page → throws
  let threw = false
  try {
    computeLayout({ photos: [{ id: 'z', width: 10, height: 10 }], pageSpec: { width: 10, height: 10 }, margins: { top: 5, right: 5, bottom: 5, left: 5 }, gap: 0 })
  } catch { threw = true }
  assert(threw, 'invalid margins throw')

  console.log('SELF-CHECK PASS: layout engine behaves correctly (4/4)')
}

// run self-check when executed directly via `node electron/layout-engine.ts`
const isDirect = process.argv[1]?.includes('layout-engine.ts') || process.argv[1]?.includes('layout-engine.js')
if (isDirect) selfCheck()
