/**
 * App — main editor shell. Toolbar (new/save/undo/redo), chapter sidebar,
 * photo browser, page canvas, properties panel. Phase 4a: frames are
 * placeholders; drag-drop/resize/swap wired to store.
 */

import { useEffect, useRef, useState } from 'react'
import type { Page, Project } from '../../../shared/types.js'
import { useEditor } from './store/editor.js'
import { CanvasPage } from './components/CanvasPage.js'
import { AppLayout } from './components/AppLayout.js'

const api = (window as any).electronAPI as {
  project: {
    create: (n: string) => Promise<Project>
    save: (p: Project) => Promise<void>
    list: () => Promise<{ id: string; name: string; createdAt: number; updatedAt: number }[]>
    get: (id: string) => Promise<Project | null>
  }
  dialog: {
    openFiles: () => Promise<string[]>
    saveFile: (defaultName: string) => Promise<string | null>
    openDirectory: () => Promise<string | null>
  }
  photos: {
    importFiles: (f: string[]) => Promise<{ id: string; sourcePath: string }[]>
    makeThumbnail: (projectId: string, photoId: string, srcPath: string) => Promise<{ width: number; height: number }>
    getThumbnail: (projectId: string, photoId: string) => Promise<{ data: string; width: number; height: number; mimetype: string } | null>
  }
  export: {
    highRes: (project: Project, srcMap: Record<string, string>, format: 'jpg' | 'png' | 'pdf', outputPath: string) => Promise<any>
  }
  layout: {
    compute: (input: { photos: { id: string; width: number; height: number }[]; pageSpec: any; margins: any; gap: number; fitMode?: string; preferGrid?: string; autoBalance?: boolean }) => Promise<{ pages: { id: string; frames: any[] }[]; warnings: any[] }>
  }
}

export default function App() {
  const {
    project, currentChapterId, currentPageId, selectedFrameId,
    history, future, loadProject, newProject, addChapter, selectChapter, renameChapter,
    addPhotos, removePhoto, addFrameToPage, selectPage, swapFrames, splitPage, replaceChapterPages, undo, redo,
  } = useEditor()
  const [photoError, setPhotoError] = useState('')
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map())
  const [zoom, setZoom] = useState(1.5) // page preview zoom multiplier
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null)
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null)
  const [showNewDlg, setShowNewDlg] = useState(false)
  const [npName, setNpName] = useState('Untitled Album')
  const [npW, setNpW] = useState('30')
  const [npH, setNpH] = useState('40')
  const [npUnit, setNpUnit] = useState<'cm' | 'in' | 'px'>('cm')
  const [npDpi, setNpDpi] = useState('300')
  const [npPages, setNpPages] = useState('1')
  const booted = useRef(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(800)
  const [spreadIdx, setSpreadIdx] = useState(0)

  const createProject = () => {
    const dpi = Math.max(72, parseInt(npDpi) || 300)
    let w = parseFloat(npW) || 30, h = parseFloat(npH) || 40
    if (npUnit === 'cm') { w = Math.round(w * dpi / 2.54); h = Math.round(h * dpi / 2.54) }
    else if (npUnit === 'in') { w = Math.round(w * dpi); h = Math.round(h * dpi) }
    newProject({ name: npName || 'Untitled Album', width: w, height: h, dpi, pageCount: parseInt(npPages) || 1 })
    setShowNewDlg(false)
    setShowHome(false)
  }

  // init: show project picker (home) on mount; don't auto-create
  useEffect(() => { booted.current = true }, [])
  const [showHome, setShowHome] = useState(true)
  const [homeProjects, setHomeProjects] = useState<{ id: string; name: string; updatedAt: number }[]>([])
  const [homeLoaded, setHomeLoaded] = useState(false)
  const loadHome = async () => {
    const list = await api.project.list()
    setHomeProjects(list)
    setHomeLoaded(true)
  }
  useEffect(() => { if (showHome) loadHome() }, [showHome])

  // auto-save: persist project whenever it changes (skip first boot)
  const savedRef = useRef<string>('')
  useEffect(() => {
    if (!project) return
    const sig = JSON.stringify(project).length + ':' + project.updatedAt
    if (sig === savedRef.current) return
    savedRef.current = sig
    const t = setTimeout(() => { api.project.save(project) }, 400)
    return () => clearTimeout(t)
  }, [project])

  // responsive canvas: track spread container width so page preview scales with window
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setCanvasW(Math.round(e.contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [showHome])

  // keyboard: undo/redo, delete frame, arrow nudge
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState()
      if (!s.project || !s.selectedFrameId || !s.currentPageId) return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); s.redo(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); s.removeFrame(s.currentPageId, s.selectedFrameId); return }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
      if (!dir) return
      e.preventDefault()
      const page = s.project.chapters.flatMap(c => c.pages).find(p => p.id === s.currentPageId)
      const f = page?.frames.find(f => f.id === s.selectedFrameId)
      if (!f) return
      const step = e.shiftKey ? 10 : 1
      const spec = s.project.pageSpec
      s.updateFrame(s.currentPageId, s.selectedFrameId, {
        x: Math.max(0, Math.min(f.x + dir[0] * step, spec.width - f.w)),
        y: Math.max(0, Math.min(f.y + dir[1] * step, spec.height - f.h)),
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openProject = async (id: string) => {
    const p = await api.project.get(id)
    if (p) {
      loadProject(p)
      setShowHome(false)
      // reload cached thumbnails for this project
      const map = new Map<string, string>()
      await Promise.all(p.photos.map(async ph => {
        try {
          const t = await api.photos.getThumbnail(p.id, ph.id)
          if (t) map.set(ph.id, t.data)
        } catch { /* stale thumb — regenerate on demand */ }
      }))
      setThumbnails(map)
    }
  }

  const handleImport = async () => {
    setPhotoError('')
    const files = await api.dialog.openFiles()
    if (!files.length) return
    // persist project first — thumbnail FK requires projects row to exist
    if (project) await api.project.save(project)
    const imported = await api.photos.importFiles(files)
    if (!imported.length) return
    // read dims via sharp, generate thumbnail, stash base64 for canvas
    const withDims = await Promise.all(imported.map(async p => {
      try {
        const dims = await api.photos.makeThumbnail(project!.id, p.id, p.sourcePath)
        const thumb = await api.photos.getThumbnail(project!.id, p.id)
        if (thumb) setThumbnails(prev => new Map(prev).set(p.id, thumb.data))
        return { id: p.id, width: dims.width, height: dims.height, sourcePath: p.sourcePath }
      } catch (e: any) {
        setPhotoError(`Thumbnail failed for ${p.sourcePath}: ${e?.message ?? e}`)
        return { id: p.id, width: 3000, height: 2000, sourcePath: p.sourcePath }
      }
    }))
    addPhotos(withDims)
    // persist photos into project row (state changed post-thumbnail)
    if (project) await api.project.save(useEditor.getState().project!)
  }

  const ch = project?.chapters.find(c => c.id === currentChapterId) ?? project?.chapters[0]
  const page = ch?.pages.find(p => p.id === currentPageId) ?? ch?.pages[0]
  const selectedFrame = page?.frames.find(f => f.id === selectedFrameId)

  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState('')

  // --- drag-drop photos to canvas ---
  const [autoGrid, setAutoGrid] = useState<'auto' | 'single' | 'two-up' | 'four-up'>('auto')
  const [autoFit, setAutoFit] = useState<'contain' | 'cover'>('cover')

  const handleAutoLayout = async () => {
    if (!project || !ch) return
    const photos = ch.photoRefs.map(pid => project.photos.find(p => p.id === pid)).filter(Boolean) as { id: string; width: number; height: number }[]
    if (!photos.length) { setPhotoError('No photos in chapter to layout'); return }
    const result = await api.layout.compute({
      photos, pageSpec: project.pageSpec,
      margins: { top: project.defaultStyle.margin, right: project.defaultStyle.margin, bottom: project.defaultStyle.margin, left: project.defaultStyle.margin },
      gap: project.defaultStyle.gap, fitMode: autoFit, preferGrid: autoGrid, autoBalance: true,
    })
    const newPages = result.pages.map(p => ({ id: p.id, frames: p.frames }))
    replaceChapterPages(ch.id, newPages)
    if (result.warnings.length) setPhotoError(result.warnings.map((w: any) => w.message).join('; '))
  }

  const onCanvasDrop = (e: React.DragEvent, targetPageId: string) => {
    e.preventDefault()
    e.stopPropagation()
    // Accept both mime types — image drags sometimes lose text/plain in Chromium
    const photoId = e.dataTransfer.getData('application/x-pickdeal-photo') || e.dataTransfer.getData('text/plain')
    if (!photoId) return
    // drop now attaches to the SVG element directly, so currentTarget may be the SVG
    const el = e.currentTarget as Element
    // For SVG, we want the rect of its parent div (the wrapper) to avoid overflow-hidden issues
    let rect: DOMRect | undefined
    if (el instanceof SVGElement) {
      const parentDiv = el.parentElement
      rect = parentDiv?.getBoundingClientRect()
    } else {
      rect = el.querySelector('svg')?.parentElement?.getBoundingClientRect()
    }
    if (!rect || rect.width === 0) return
    const spec = project!.pageSpec
    const scale = rect.width / spec.width // page-space px per screen px at current zoom
    const x = (e.clientX - rect.left) / scale
    const y = (e.clientY - rect.top) / scale
    const ph = project?.photos.find(p => p.id === photoId)
    if (!ph) return
    const m = project!.defaultStyle
    const r = ph.width / Math.max(1, ph.height)
    const w = Math.min((spec.width - m.margin * 2) * 0.9, (spec.height - m.margin * 2) * 0.75 * r)
    const h = w / r
    const frameX = Math.round(Math.max(m.margin, Math.min(x - w / 2, spec.width - m.margin - w)))
    const frameY = Math.round(Math.max(m.margin, Math.min(y - h / 2, spec.height - m.margin - h)))
    console.log('frame computed:', { frameX, frameY, w, h, specWidth: spec.width, specHeight: spec.height, margin: m.margin })
    const newFrame = (useEditor.getState().project?.chapters.find(ch => ch.pages.find(p => p.id === targetPageId))?.pages.find(p => p.id === targetPageId)?.frames ?? []).at(-1)
    if (newFrame) {
      useEditor.getState().selectFrame(newFrame.id)
    }
    addFrameToPage(targetPageId, photoId, frameX, frameY, Math.round(w), Math.round(h))
    // clear visual highlight
    e.currentTarget.classList.remove('ring-2', 'ring-indigo-500', 'ring-offset-2', 'ring-offset-white')
  }

  const onCanvasDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    e.currentTarget.classList.add('ring-2', 'ring-indigo-500', 'ring-offset-2', 'ring-offset-white')
  }

  const onCanvasDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('ring-2', 'ring-indigo-500', 'ring-offset-2', 'ring-offset-white')
  }

  const handleExport = async (format: 'jpg' | 'png' | 'pdf') => {
    if (!project) return
    setExporting(true); setExportMsg('')
    try {
      const defaultName = `${project.name}.${format}`
      const out = format === 'pdf'
        ? await api.dialog.saveFile(defaultName)
        : await api.dialog.openDirectory()
      if (!out) { setExporting(false); return }
      const srcMap: Record<string, string> = {}
      for (const ph of project.photos) if (ph.sourcePath) srcMap[ph.id] = ph.sourcePath
      if (format === 'pdf') {
        const res = await api.export.highRes(project, srcMap, 'pdf', out)
        setExportMsg(`Exported PDF (${res.bytes} bytes)`)
      } else {
        // JPG/PNG writes per-page files into chosen directory; openDirectory returns dir path
        const res = await api.export.highRes(project, srcMap, format, out)
        setExportMsg(`Exported ${res.length} page(s) to ${out}`)
      }
    } catch (e: any) {
      setExportMsg(`Export failed: ${e?.message ?? e}`)
    } finally { setExporting(false) }
  }

  if (showHome) {
    return (
      <div className="h-screen bg-neutral-900 text-neutral-100 flex flex-col">
        <header className="px-6 py-4 border-b border-neutral-800 flex items-center gap-3">
          <span className="font-semibold text-lg">PickDeAlbum</span>
          <button className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-sm font-medium" onClick={() => { setShowNewDlg(true) }}>New Project</button>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <h2 className="text-xs text-neutral-400 uppercase mb-3">Projects</h2>
          {!homeLoaded && <div className="text-sm text-neutral-400">Loading…</div>}
          {homeLoaded && homeProjects.length === 0 && <div className="text-sm text-neutral-400">No projects yet. Create one to get started.</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl">
            {homeProjects.map(p => (
              <button key={p.id} className="text-left p-4 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
                onClick={() => openProject(p.id)}>
                <div className="font-medium truncate">{p.name}</div>
                <div className="text-xs text-neutral-400 mt-1">{new Date(p.updatedAt).toLocaleDateString()}</div>
              </button>
            ))}
          </div>
        </main>
        {showNewDlg && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowNewDlg(false)}>
            <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
              <h2 className="text-sm font-semibold mb-4">New Project</h2>
              <label className="block text-xs mb-3">Project Name
                <input className="w-full mt-1 px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-sm"
                  value={npName} onChange={e => setNpName(e.target.value)} />
              </label>
              <div className="flex gap-2 mb-3">
                <label className="block text-xs flex-1">Width
                  <input className="w-full mt-1 px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-sm"
                    value={npW} onChange={e => setNpW(e.target.value)} />
                </label>
                <label className="block text-xs flex-1">Height
                  <input className="w-full mt-1 px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-sm"
                    value={npH} onChange={e => setNpH(e.target.value)} />
                </label>
              </div>
              <div className="flex gap-2 mb-3">
                <label className="block text-xs flex-1">Unit
                  <select className="w-full mt-1 px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-sm"
                    value={npUnit} onChange={e => setNpUnit(e.target.value as any)}>
                    <option value="cm">cm</option>
                    <option value="in">inch</option>
                    <option value="px">pixel</option>
                  </select>
                </label>
                <label className="block text-xs flex-1">Resolution (DPI)
                  <input className="w-full mt-1 px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-sm"
                    value={npDpi} onChange={e => setNpDpi(e.target.value)} />
                </label>
              </div>
              <label className="block text-xs mb-3">Number of Pages
                <input type="number" min="1" className="w-full mt-1 px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-sm"
                  value={npPages} onChange={e => setNpPages(e.target.value)} />
              </label>
              <div className="flex justify-end gap-2 mt-4">
                <button className="px-3 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-sm" onClick={() => setShowNewDlg(false)}>Cancel</button>
                <button className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-sm font-medium" onClick={createProject}>Create</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (!project || !ch || !page) return <div className="h-screen bg-neutral-900 text-neutral-200 flex items-center justify-center">Loading…</div>

  return (
    <AppLayout
      projectName={project.name}
      sheetInfo={`${(project.pageSpec.width / (project.pageSpec.dpi || 300)).toFixed(0)}×${(project.pageSpec.height / (project.pageSpec.dpi || 300)).toFixed(0)} / ${ch.pages.length} page${ch.pages.length === 1 ? '' : 's'}`}
      canUndo={history.length > 0}
      canRedo={future.length > 0}
      onUndo={undo}
      onRedo={redo}
      onExport={() => handleExport('jpg')}
      onProofing={() => setExportMsg('Proofing — not implemented yet')}
      notice={photoError || exportMsg}
      chapterTabs={
        <>
          {project.chapters.map(c => {
            const isCh = c.id === ch.id
            const cur = project.chapters.find(x => x.id === currentChapterId) ?? project.chapters[0]
            return (
              <button key={c.id}
                className={`px-3 py-1.5 text-xs whitespace-nowrap border-b-2 ${isCh ? 'border-neutral-800 text-neutral-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                onClick={() => { selectChapter(c.id); if (editingChapterId !== c.id) setEditingChapterId(null) }}
                onDoubleClick={e => { e.stopPropagation(); setEditingChapterId(c.id) }}>
                {editingChapterId === c.id ? (
                  <input autoFocus className="w-24 bg-gray-50 border border-gray-300 rounded px-1 py-0.5 text-xs"
                    defaultValue={c.title}
                    onBlur={e => { renameChapter(c.id, e.target.value || c.title); setEditingChapterId(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    onClick={e => e.stopPropagation()} />
                ) : <>{c.title} <span className="text-gray-400">{c.pages.length}</span></>}
              </button>
            )
          })}
          <button className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-700" title="Add chapter" onClick={addChapter}>＋</button>
        </>
      }
      photoTray={
        <>
          {ch.photoRefs.length === 0 && (
            <button onClick={handleImport} className="shrink-0 px-3 h-20 rounded border border-dashed border-gray-300 text-xs text-gray-400 hover:border-neutral-400 hover:text-gray-600">
              ＋ Import photos
            </button>
          )}
          {ch.photoRefs.map(pid => {
            const ph = project.photos.find(p => p.id === pid)
            if (!ph) return null
            const onDragStart = (e: React.DragEvent) => {
              // set both mime types: Chromium/Electron image drags can eat text/plain alone
              e.dataTransfer.setData('text/plain', pid)
              e.dataTransfer.setData('application/x-pickdeal-photo', pid)
              e.dataTransfer.effectAllowed = 'copy'
            }
            return (
              <div key={pid} draggable
                onDragStart={onDragStart}
                className="shrink-0 w-20 h-20 rounded border border-gray-200 bg-gray-50 hover:border-neutral-400 cursor-grab relative group"
                title={ph.sourcePath?.split(/[\\/]/).pop() ?? pid}>
                {thumbnails.get(pid) ? (
                  <img src={`data:image/webp;base64,${thumbnails.get(pid)}`} alt="" draggable={false}
                    className="w-full h-full object-cover rounded pointer-events-none" />
                ) : <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">…</div>}
                <button className="absolute top-0 right-0 w-4 h-4 bg-black/40 text-white text-[10px] rounded-bl opacity-0 group-hover:opacity-100"
                  onClick={() => removePhoto(pid)}>×</button>
              </div>
            )
          })}
        </>
      }
      toolbar={
        <>
          <ToolBtn label="Shuffle" glyph="⇄" onClick={handleAutoLayout} disabled={!ch?.photoRefs.length} />
          <ToolBtn label="Split" glyph="‖" onClick={() => splitPage(ch.id, page.id)} disabled={page.frames.length <= 2} />
          <div className="w-6 h-px bg-gray-200 my-1 mx-auto" />
          <ToolBtn label="Fit (no crop)" glyph="⬐" active={autoFit === 'contain'} onClick={() => setAutoFit('contain')} />
          <ToolBtn label="Fill (crop)" glyph="⬔" active={autoFit === 'cover'} onClick={() => setAutoFit('cover')} />
          <div className="w-6 h-px bg-gray-200 my-1 mx-auto" />
          <ToolBtn label="Grid: auto" glyph="▦" active={autoGrid === 'auto'} onClick={() => setAutoGrid('auto')} />
          <ToolBtn label="Grid: 1" glyph="▢" active={autoGrid === 'single'} onClick={() => setAutoGrid('single')} />
          <ToolBtn label="Grid: 2" glyph="▥" active={autoGrid === 'two-up'} onClick={() => setAutoGrid('two-up')} />
          <ToolBtn label="Grid: 4" glyph="▤" active={autoGrid === 'four-up'} onClick={() => setAutoGrid('four-up')} />
        </>
      }
      pages={
        <div ref={canvasRef} className="flex flex-col items-center gap-4">
          {/* Spread view */}
          {(() => {
            const left = ch.pages[spreadIdx * 2]
            const right = ch.pages[spreadIdx * 2 + 1]
            return (
              <>
                <div className="flex shadow-2xl rounded-sm overflow-hidden bg-white">
                  {left ? (
                    <div onClick={() => selectPage(left.id)}
                      onDragOver={onCanvasDragOver} onDragLeave={onCanvasDragLeave}
                      className={`relative transition-all ${left.id === page.id ? 'ring-2 ring-indigo-500 ring-inset' : ''}`}>
                      <SpreadPage project={project} page={left} thumbnails={thumbnails}
                        swapTargetId={swapTargetId} onSwap={(a, b) => { swapFrames(left.id, a, b); setSwapTargetId(null) }}
                        onDrop={e => onCanvasDrop(e, left.id)}
                        previewW={Math.max(160, Math.round((canvasW - 80) / 2 * zoom))} />
                    </div>
                  ) : <div className="bg-gray-50 border border-dashed border-gray-300" style={{ width: Math.max(160, Math.round((canvasW - 80) / 2 * zoom)), aspectRatio: `${project.pageSpec.width}/${project.pageSpec.height}` }} />}
                  {/* spine */}
                  <div className="w-px bg-gray-300 relative z-10">
                    <div className="absolute inset-y-0 -left-px w-2 -translate-x-1 bg-gradient-to-r from-black/10 to-transparent" />
                    <div className="absolute inset-y-0 right-px w-2 translate-x-px bg-gradient-to-l from-black/10 to-transparent" />
                  </div>
                  {right ? (
                    <div onClick={() => selectPage(right.id)}
                      onDragOver={onCanvasDragOver} onDragLeave={onCanvasDragLeave}
                      className={`relative transition-all ${right.id === page.id ? 'ring-2 ring-indigo-500 ring-inset' : ''}`}>
                      <SpreadPage project={project} page={right} thumbnails={thumbnails}
                        swapTargetId={swapTargetId} onSwap={(a, b) => { swapFrames(right.id, a, b); setSwapTargetId(null) }}
                        onDrop={e => onCanvasDrop(e, right.id)}
                        previewW={Math.max(160, Math.round((canvasW - 80) / 2 * zoom))} />
                    </div>
                  ) : <div className="bg-gray-50 border border-dashed border-gray-300" style={{ width: Math.max(160, Math.round((canvasW - 80) / 2 * zoom)), aspectRatio: `${project.pageSpec.width}/${project.pageSpec.height}` }} />}
                </div>
                {/* spread navigation */}
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <button className="w-7 h-7 rounded border border-gray-300 hover:bg-gray-50" disabled={spreadIdx === 0} onClick={() => setSpreadIdx(i => Math.max(0, i - 1))}>←</button>
                  <span>Spread {spreadIdx + 1} / {Math.ceil(ch.pages.length / 2)}</span>
                  <button className="w-7 h-7 rounded border border-gray-300 hover:bg-gray-50" disabled={spreadIdx >= Math.ceil(ch.pages.length / 2) - 1} onClick={() => setSpreadIdx(i => i + 1)}>→</button>
                </div>
              </>
            )
          })()}
        </div>
      }
    />
  )
}

/** Floating toolbar button. */
function ToolBtn({ label, glyph, onClick, active, disabled }: { label: string; glyph: string; onClick?: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button title={label} aria-label={label} disabled={disabled}
      className={`w-10 h-10 flex items-center justify-center rounded-md transition-colors disabled:opacity-30
        ${active ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900'}`}
      onClick={onClick}>
      <span className="text-lg leading-none select-none">{glyph}</span>
    </button>
  )
}

/** A page used inside a spread — CanvasPage wrapped in white paper styling. */
function SpreadPage({ project, page, thumbnails, swapTargetId, onSwap, onDrop, previewW }: {
  project: Project; page: Page; thumbnails: Map<string, string>
  swapTargetId: string | null; onSwap: (a: string, b: string) => void; onDrop?: (e: React.DragEvent) => void; previewW: number
}) {
  return (
    <div className="bg-white relative">
      <CanvasPage project={project} page={page} thumbnails={thumbnails}
        swapTargetId={swapTargetId} onSwap={onSwap} onDrop={onDrop} previewW={previewW} />
    </div>
  )
}