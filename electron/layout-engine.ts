/**
 * PickDeAlbum — Auto Layout Engine ("PackedFit-1")
 *
 * Grid-based packer: choose grid (cols × rows) from photo count + dominant
 * ratio, then fit each photo into its cell (contain, no-crop). Pure function.
 *
 * Math units: CSS pixels. 300 DPI print target = same coordinate space.
 */

import type { LayoutInput, LayoutResult, RenderPage, Frame, Photo, Margin } from '../shared/types.js'

const makeIdGen = (prefix: string) => {
  let n = 0
  return () => `${prefix}${(n++).toString(36)}`
}
const pgId = makeIdGen('pg'), frId = makeIdGen('fr')

function ratio(p: Photo): number {
  const orient = p.orientation ?? 1
  const swapped = [5, 6, 7, 8].includes(orient)
  const w = swapped ? p.height : p.width
  const h = swapped ? p.width : p.height
  return w / Math.max(1, h)
}

const FULL_CROP = { ox: 0, oy: 0, cx: 1, cy: 1 }

function coverCrop(photo: Photo, fw: number, fh: number): Frame['crop'] {
  const orient = photo.orientation ?? 1
  const swapped = [5, 6, 7, 8].includes(orient)
  const sw = swapped ? photo.height : photo.width
  const sh = swapped ? photo.width : photo.height
  const frameR = fw / fh, photoR = sw / sh
  let cropW: number, cropH: number
  if (photoR > frameR) { cropW = sh * frameR; cropH = sh }
  else { cropW = sw; cropH = sw / frameR }
  return { ox: (sw - cropW) / 2 / sw, oy: (sh - cropH) / 2 / sh, cx: cropW / sw, cy: cropH / sh }
}

export function computeLayout(input: LayoutInput): LayoutResult {
  const {
    photos, pageSpec, margins, gap,
    fitMode = 'contain', preferGrid = 'auto',
  } = input
  const warnings: LayoutResult['warnings'] = []
  const W = pageSpec.width, H = pageSpec.height
  const m: Margin = margins
  const contentW = W - m.left - m.right
  const contentH = H - m.top - m.bottom
  if (contentW <= 0 || contentH <= 0) throw new Error('layout: margins exceed page')
  if (photos.length === 0) return { pages: [], warnings: [] }

  const ps = photos.map(p => ({ p, r: ratio(p) }))

  function gridFor(count: number): { cols: number; rows: number } {
    if (preferGrid === 'single') return { cols: 1, rows: 1 }
    if (preferGrid === 'two-up') return { cols: 2, rows: 1 }
    if (preferGrid === 'four-up') return { cols: 2, rows: 2 }
    // auto: choose grid based on count
    if (count <= 1) return { cols: 1, rows: 1 }
    if (count <= 2) return { cols: 2, rows: 1 }
    if (count <= 4) return { cols: 2, rows: 2 }
    if (count <= 6) return { cols: 3, rows: 2 }
    return { cols: 3, rows: 2 }
  }

  function packPage(pool: { p: Photo; r: number }[], cols: number, rows: number): { frames: Frame[]; used: number } {
    const cellW = (contentW - gap * (cols - 1)) / cols
    const cellH = (contentH - gap * (rows - 1)) / rows
    const frames: Frame[] = []
    let used = 0
    for (let row = 0; row < rows && used < pool.length; row++) {
      for (let col = 0; col < cols && used < pool.length; col++) {
        const photo = pool[used]
        const photoAR = photo.r, cellAR = cellW / cellH
        let fw: number, fh: number
        if (fitMode === 'cover') {
          // cover: frame fills cell exactly; photo cropped to cell ratio
          fw = cellW; fh = cellH
        } else {
          // contain: frame keeps photo ratio within cell
          if (photoAR > cellAR) { fw = cellW; fh = cellW / photoAR }
          else { fh = cellH; fw = cellH * photoAR }
          if (fw > cellW) { fw = cellW; fh = cellW / photoAR }
          if (fh > cellH) { fh = cellH; fw = cellH * photoAR }
        }
        const x = m.left + col * (cellW + gap)
        const y = m.top + row * (cellH + gap)
        const crop = fitMode === 'cover' ? coverCrop(photo.p, fw, fh) : FULL_CROP
        frames.push({
          id: frId(), photoId: photo.p.id,
          x: Math.round(x), y: Math.round(y), w: Math.round(fw), h: Math.round(fh),
          rotation: 0, zIndex: used, crop, fit: fitMode,
        })
        used++
      }
    }
    return { frames, used }
  }

  const grid = gridFor(ps.length)
  const pages: RenderPage[] = []
  let i = 0
  while (i < ps.length) {
    const { frames } = packPage(ps.slice(i), grid.cols, grid.rows)
    pages.push({ id: pgId(), frames })
    i += frames.length
  }

  return { pages, warnings }
}

// ---------------------------------------------------------------------------
// self-check
// ---------------------------------------------------------------------------

function selfCheck() {
  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error('SELF-CHECK FAIL: ' + msg) }

  // 1) 5 mixed photos → all placed
  const r1 = computeLayout({
    photos: [
      { id: 'a', width: 3000, height: 4500 }, { id: 'b', width: 4500, height: 3000 },
      { id: 'c', width: 2000, height: 2000 }, { id: 'd', width: 3000, height: 4500 },
      { id: 'e', width: 4500, height: 3000 },
    ],
    pageSpec: { width: 3035, height: 4054 }, margins: { top: 120, right: 120, bottom: 120, left: 120 },
    gap: 20, fitMode: 'contain',
  })
  const total = r1.pages.reduce((a, p) => a + p.frames.length, 0)
  assert(total === 5, `all 5 photos placed (got ${total})`)

  // 2) 4 landscape photos → 1 page 2x2
  const r2 = computeLayout({
    photos: Array.from({ length: 4 }, (_, i) => ({ id: 'p' + i, width: 4032, height: 3024 })),
    pageSpec: { width: 3035, height: 4054 }, margins: { top: 120, right: 120, bottom: 120, left: 120 },
    gap: 20, fitMode: 'contain',
  })
  assert(r2.pages.length === 1, `4 landscape photos → 1 page (got ${r2.pages.length})`)
  assert(r2.pages[0].frames.length === 4, `4 frames on page (got ${r2.pages[0].frames.length})`)

  // 3) 4 portrait photos → 1 page 2x2
  const r3 = computeLayout({
    photos: Array.from({ length: 4 }, (_, i) => ({ id: 'p' + i, width: 3024, height: 4032 })),
    pageSpec: { width: 3035, height: 4054 }, margins: { top: 120, right: 120, bottom: 120, left: 120 },
    gap: 20, fitMode: 'contain',
  })
  assert(r3.pages.length === 1, `4 portrait photos → 1 page (got ${r3.pages.length})`)
  assert(r3.pages[0].frames.length === 4, `4 frames on page (got ${r3.pages[0].frames.length})`)

  // 4) cover mode crops
  const r4 = computeLayout({
    photos: [{ id: 'x', width: 4500, height: 3000 }],
    pageSpec: { width: 3035, height: 4054 }, margins: { top: 0, right: 0, bottom: 0, left: 0 }, gap: 0,
    fitMode: 'cover',
  })
  const c = r4.pages[0].frames[0].crop
  assert(c.cy === 1 && c.ox > 0 && c.cx < 1, `cover crops width: ${JSON.stringify(c)}`)

  // 5) zero photos → empty
  const r5 = computeLayout({ photos: [], pageSpec: { width: 100, height: 100 }, margins: { top: 0, right: 0, bottom: 0, left: 0 }, gap: 0 })
  assert(r5.pages.length === 0, 'empty input ⇒ empty result')

  // 6) margins exceed page → throws
  let threw = false
  try {
    computeLayout({ photos: [{ id: 'z', width: 10, height: 10 }], pageSpec: { width: 10, height: 10 }, margins: { top: 5, right: 5, bottom: 5, left: 5 }, gap: 0 })
  } catch { threw = true }
  assert(threw, 'invalid margins throw')

  console.log('SELF-CHECK PASS: layout engine (6/6)')
}

const isDirect = process.argv[1]?.includes('layout-engine.ts') || process.argv[1]?.includes('layout-engine.js')
if (isDirect) selfCheck()