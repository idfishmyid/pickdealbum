/**
 * CanvasPage — renders one album page. Frame placeholders (no actual images
 * yet in Phase 4a): gray boxes at frame geometry. Selection + resize handles.
 */

import { useState } from 'react'
import type { Page, Project, Frame } from '../../../shared/types.js'
import { useEditor } from '../store/editor.js'

const SCALE = 0.5 // preview scale: 3035px → ~1518px CSS

export function CanvasPage({ project, page }: { project: Project; page: Page }) {
  const { selectedFrameId, selectFrame, updateFrame } = useEditor()
  const [dragging, setDragging] = useState<null | { id: string; dir: string; startX: number; startY: number; orig: { x: number; y: number; w: number; h: number } }>(null)

  const W = project.pageSpec.width
  const H = project.pageSpec.height

  const onResizePointerDown = (e: React.PointerEvent, frame: Frame, dir: string) => {
    e.stopPropagation()
    selectFrame(frame.id)
    setDragging({ id: frame.id, dir, startX: e.clientX, startY: e.clientY, orig: { x: frame.x, y: frame.y, w: frame.w, h: frame.h } })
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const dx = (e.clientX - dragging.startX) / SCALE
    const dy = (e.clientY - dragging.startY) / SCALE
    const o = dragging.orig
    let x = o.x, y = o.y, w = o.w, h = o.h
    if (dragging.dir.includes('e')) w = o.w + dx
    if (dragging.dir.includes('s')) h = o.h + dy
    if (dragging.dir.includes('w')) { w = o.w - dx; x = o.x + dx }
    if (dragging.dir.includes('n')) { h = o.h - dy; y = o.y + dy }
    w = Math.max(40, Math.min(w, W - x))
    h = Math.max(40, Math.min(h, H - y))
    updateFrame(page.id, dragging.id, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })
  }

  const onPointerUp = () => setDragging(null)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: W * SCALE, height: H * SCALE, background: project.pageSpec.background, border: '1px solid #3f3f46' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {page.frames.map((f) => {
        const selected = f.id === selectedFrameId
        const hs = 14 // handle size
        return (
          <g key={f.id} onPointerDown={(e) => { e.stopPropagation(); selectFrame(f.id) }}>
            <rect
              x={f.x} y={f.y} width={f.w} height={f.h}
              fill="#3f3f46" stroke={selected ? '#818cf8' : '#52525b'} strokeWidth={selected ? 3 : 1}
            />
            {selected && (
              <>
                <rect x={f.x - hs / 2} y={f.y - hs / 2} width={hs} height={hs} fill="#818cf8" cursor="nwse-resize"
                  onPointerDown={(e) => onResizePointerDown(e, f, 'nw')} />
                <rect x={f.x + f.w - hs / 2} y={f.y - hs / 2} width={hs} height={hs} fill="#818cf8" cursor="nesw-resize"
                  onPointerDown={(e) => onResizePointerDown(e, f, 'ne')} />
                <rect x={f.x - hs / 2} y={f.y + f.h - hs / 2} width={hs} height={hs} fill="#818cf8" cursor="nesw-resize"
                  onPointerDown={(e) => onResizePointerDown(e, f, 'sw')} />
                <rect x={f.x + f.w - hs / 2} y={f.y + f.h - hs / 2} width={hs} height={hs} fill="#818cf8" cursor="nwse-resize"
                  onPointerDown={(e) => onResizePointerDown(e, f, 'se')} />
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}