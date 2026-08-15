/**
 * CanvasPage — renders one album page at preview scale. Supports both
 * frame move (drag body) and frame resize (drag corner handles).
 */

import { useState, useEffect } from 'react'
import type { Page, Project, Frame } from '../../../../shared/types.js'
import { useEditor } from '../store/editor.js'

const SNAP = 6 // px distance (page space) to magnet to a guide
const SNAP_STEP = 2 // step size when no guide found (page space)

type Guide = { vertical?: number; horizontal?: number }
type Rect = { x: number; y: number; w: number; h: number }
type DragState = {
  id: string
  mode: 'move' | 'resize'
  dir?: string // only for resize: 'nw', 'ne', 'sw', 'se'
  startX: number
  startY: number
  orig: Rect
  origAll: Map<string, Rect> // per-frame start rects for multi-select move
  guide?: Guide
}

export function CanvasPage({ project, page, thumbnails, swapTargetId, onSwap, onDrop, previewW = 600 }: {
  project: Project; page: Page; thumbnails: Map<string, string>
  swapTargetId: string | null
  onSwap: (a: string, b: string) => void
  onDrop?: (e: React.DragEvent) => void
  previewW?: number
}) {
  const { selectedFrameId, selectFrame, updateFrame } = useEditor()
  const [dragging, setDragging] = useState<DragState | null>(null)
  const [extraSel, setExtraSel] = useState<Set<string>>(new Set()) // Shift+click multi-select (local)
  const [loadedThumbnails, setLoadedThumbnails] = useState<Map<string, string>>(new Map())

  const W = project.pageSpec.width
  const H = project.pageSpec.height
  const scale = previewW / W

  const selSet = (id: string) => id === selectedFrameId || extraSel.has(id)

  // on-demand thumbnail load for frames without thumbnails
  useEffect(() => {
    const api = (window as any).electronAPI
    if (!api?.photos?.getThumbnail) return

    page.frames.forEach(f => {
      if (!thumbnails.has(f.photoId) && !loadedThumbnails.has(f.photoId)) {
        api.photos.getThumbnail(project.id, f.photoId)
          .then((thumb: any) => {
            if (thumb?.data) {
              setLoadedThumbnails(prev => new Map(prev).set(f.photoId, thumb.data))
            }
          })
          .catch(() => {})
      }
    })
  }, [page.frames.map(f => f.photoId).join(','), project.id])

  // --- frame body drag (move) ---
  const onFramePointerDown = (e: React.PointerEvent, frame: Frame, mode: 'move' | 'resize', dir?: string) => {
    e.stopPropagation()
    if (mode === 'move' && e.shiftKey) {
      // shift-click: toggle multi-select without changing primary
      const has = selSet(frame.id)
      setExtraSel(prev => {
        const n = new Set(prev)
        if (has) n.delete(frame.id)
        else if (frame.id !== selectedFrameId) n.add(frame.id)
        return n
      })
      return
    }
    if (mode === 'move') setExtraSel(new Set()) // plain click resets multi
    selectFrame(frame.id)
    const origAll = new Map<string, Rect>()
    for (const f of page.frames) if (selSet(f.id)) origAll.set(f.id, { x: f.x, y: f.y, w: f.w, h: f.h })
    setDragging({ id: frame.id, mode, dir, startX: e.clientX, startY: e.clientY, orig: { x: frame.x, y: frame.y, w: frame.w, h: frame.h }, origAll })
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const dx = (e.clientX - dragging.startX) / scale
    const dy = (e.clientY - dragging.startY) / scale
    const o = dragging.orig

    if (dragging.mode === 'move') {
      let x = o.x + dx, y = o.y + dy
      x = Math.max(0, Math.min(x, W - o.w))
      y = Math.max(0, Math.min(y, H - o.h))
      // snap to sibling edges + page margins/center while dragging
      const guide: Guide = {}
      let gx = x, gy = y
      for (const other of page.frames) {
        if (other.id === dragging.id) continue
        for (const [a, b] of [[gx, other.x], [gx + o.w, other.x + other.w], [gx, other.x + other.w]] as [number, number][]) {
          if (Math.abs(a - b) <= SNAP) { gx = b; guide.vertical = b }
        }
        for (const [a, b] of [[gy, other.y], [gy + o.h, other.y + other.h], [gy, other.y + other.h]] as [number, number][]) {
          if (Math.abs(a - b) <= SNAP) { gy = b; guide.horizontal = b }
        }
      }
      const cx = W / 2, cy = H / 2
      if (Math.abs(gx + o.w / 2 - cx) <= SNAP) { gx = cx - o.w / 2; guide.vertical = cx }
      if (Math.abs(gy + o.h / 2 - cy) <= SNAP) { gy = cy - o.h / 2; guide.horizontal = cy }
      x = Math.max(0, Math.min(gx, W - o.w))
      y = Math.max(0, Math.min(gy, H - o.h))
      // apply to all selected frames (origAll preserves individual origins)
      const deltaX = Math.round(x - o.x)
      const deltaY = Math.round(y - o.y)
      for (const [fid, orig] of dragging.origAll ?? new Map()) {
        updateFrame(page.id, fid, {
          x: Math.max(0, Math.min(orig.x + deltaX, W - orig.w)),
          y: Math.max(0, Math.min(orig.y + deltaY, H - orig.h)),
        })
      }
      setDragging({ ...dragging, guide })
    } else {
      let x = o.x, y = o.y, w = o.w, h = o.h
      if (dragging.dir?.includes('e')) w = o.w + dx
      if (dragging.dir?.includes('s')) h = o.h + dy
      if (dragging.dir?.includes('w')) { w = o.w - dx; x = o.x + dx }
      if (dragging.dir?.includes('n')) { h = o.h - dy; y = o.y + dy }
      w = Math.max(40, Math.min(w, W - x))
      h = Math.max(40, Math.min(h, H - y))
      updateFrame(page.id, dragging.id, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })
    }
  }

  const onPointerUp = () => setDragging(null)
  const clearGuide = () => setDragging(d => d ? { ...d, guide: undefined } : d)

  const hs = 14 // handle size

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: previewW, height: previewW * H / W, background: project.pageSpec.background, border: '1px solid #3f3f46', touchAction: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
      onDrop={onDrop}
    >
      {page.frames.map((f) => {
        const selected = selSet(f.id)
        const thumb = thumbnails.get(f.photoId) || loadedThumbnails.get(f.photoId)
        return (
          <g key={f.id}>
            {/* frame body: image or placeholder */}
            <rect
              x={f.x} y={f.y} width={f.w} height={f.h}
              fill={thumbnails.get(f.photoId) ? undefined : '#3f3f46'}
              stroke={selected ? '#818cf8' : '#52525b'} strokeWidth={selected ? 3 : 1}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                e.stopPropagation()
                if (swapTargetId && swapTargetId !== f.id) { onSwap(swapTargetId, f.id); return }
                onFramePointerDown(e, f, 'move')
              }}
            />
            {(thumbnails.get(f.photoId) || loadedThumbnails.get(f.photoId)) && (
              <foreignObject x={f.x} y={f.y} width={f.w} height={f.h} pointerEvents="none">
                <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
                  <img src={`data:image/webp;base64,${thumbnails.get(f.photoId) || loadedThumbnails.get(f.photoId)}`} alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              </foreignObject>
            )}
            {f.caption && (
              <>
                <rect x={f.x} y={f.y + f.h - 18} width={f.w} height={18} fill="rgba(0,0,0,0.55)" pointerEvents="none" />
                <text x={f.x + 6} y={f.y + f.h - 6} fill="#fff" fontSize={11} pointerEvents="none">{f.caption}</text>
              </>
            )}
            {/* resize handles (only when selected) */}
            {selected && (
              <>
                <rect x={f.x - hs / 2} y={f.y - hs / 2} width={hs} height={hs} fill="#818cf8" cursor="nwse-resize"
                  onPointerDown={(e) => onFramePointerDown(e, f, 'resize', 'nw')} />
                <rect x={f.x + f.w - hs / 2} y={f.y - hs / 2} width={hs} height={hs} fill="#818cf8" cursor="nesw-resize"
                  onPointerDown={(e) => onFramePointerDown(e, f, 'resize', 'ne')} />
                <rect x={f.x - hs / 2} y={f.y + f.h - hs / 2} width={hs} height={hs} fill="#818cf8" cursor="nesw-resize"
                  onPointerDown={(e) => onFramePointerDown(e, f, 'resize', 'sw')} />
                <rect x={f.x + f.w - hs / 2} y={f.y + f.h - hs / 2} width={hs} height={hs} fill="#818cf8" cursor="nwse-resize"
                  onPointerDown={(e) => onFramePointerDown(e, f, 'resize', 'se')} />
              </>
            )}
          </g>
        )
      })}
      {dragging?.guide?.vertical !== undefined && (
        <line x1={dragging.guide.vertical} y1={0} x2={dragging.guide.vertical} y2={H}
          stroke="#818cf8" strokeWidth={1} strokeDasharray="4,4" pointerEvents="none" />
      )}
      {dragging?.guide?.horizontal !== undefined && (
        <line x1={0} y1={dragging.guide.horizontal} x2={W} y2={dragging.guide.horizontal}
          stroke="#818cf8" strokeWidth={1} strokeDasharray="4,4" pointerEvents="none" />
      )}
    </svg>
  )
}