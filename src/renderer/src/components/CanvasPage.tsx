/**
 * CanvasPage — renders one album page at preview scale. Supports both
 * frame move (drag body) and frame resize (drag corner handles).
 */

import { useState } from 'react'
import type { Page, Project, Frame } from '../../../shared/types.js'
import { useEditor } from '../store/editor.js'

const SCALE = 0.5

type DragState = {
  id: string
  mode: 'move' | 'resize'
  dir?: string // only for resize: 'nw', 'ne', 'sw', 'se'
  startX: number
  startY: number
  orig: { x: number; y: number; w: number; h: number }
}

export function CanvasPage({ project, page, thumbnails, swapTargetId, onSwap }: {
  project: Project; page: Page; thumbnails: Map<string, string>
  swapTargetId: string | null
  onSwap: (a: string, b: string) => void
}) {
  const { selectedFrameId, selectFrame, updateFrame } = useEditor()
  const [dragging, setDragging] = useState<DragState | null>(null)

  const W = project.pageSpec.width
  const H = project.pageSpec.height

  // --- frame body drag (move) ---
  const onFramePointerDown = (e: React.PointerEvent, frame: Frame, mode: 'move' | 'resize', dir?: string) => {
    e.stopPropagation()
    selectFrame(frame.id)
    setDragging({ id: frame.id, mode, dir, startX: e.clientX, startY: e.clientY, orig: { x: frame.x, y: frame.y, w: frame.w, h: frame.h } })
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const dx = (e.clientX - dragging.startX) / SCALE
    const dy = (e.clientY - dragging.startY) / SCALE
    const o = dragging.orig

    if (dragging.mode === 'move') {
      let x = o.x + dx, y = o.y + dy
      x = Math.max(0, Math.min(x, W - o.w))
      y = Math.max(0, Math.min(y, H - o.h))
      updateFrame(page.id, dragging.id, { x: Math.round(x), y: Math.round(y) })
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

  const hs = 14 // handle size

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', maxWidth: W * SCALE, background: project.pageSpec.background, border: '1px solid #3f3f46', touchAction: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {page.frames.map((f) => {
        const selected = f.id === selectedFrameId
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
            {thumbnails.get(f.photoId) && (
              <foreignObject x={f.x} y={f.y} width={f.w} height={f.h} pointerEvents="none">
                <div xmlns="http://www.w3.org/1999/xhtml" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <img src={`data:image/webp;base64,${thumbnails.get(f.photoId)}`} alt=""
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
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
    </svg>
  )
}