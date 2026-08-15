/**
 * App — main editor shell. Toolbar (new/save/undo/redo), chapter sidebar,
 * photo browser, page canvas, properties panel. Phase 4a: frames are
 * placeholders; drag-drop/resize/swap wired to store.
 */

import { useEffect, useRef, useState } from 'react'
import type { Project } from '../../../shared/types.js'
import { useEditor } from './store/editor.js'
import { CanvasPage } from './components/CanvasPage.js'

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
    addPhotos, removePhoto, addFrameToPage, selectPage, selectFrame, updateFrame, removeFrame, swapFrames, splitPage, replaceChapterPages, undo, redo,
  } = useEditor()
  const [photoError, setPhotoError] = useState('')
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map())
  const [showOpenList, setShowOpenList] = useState(false)
  const [zoom, setZoom] = useState(1.5) // page preview zoom multiplier
  const [projectList, setProjectList] = useState<{ id: string; name: string; updatedAt: number }[]>([])
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null)
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null)
  const [dragPhotoId, setDragPhotoId] = useState<string | null>(null)
  const [showNewDlg, setShowNewDlg] = useState(false)
  const [npName, setNpName] = useState('Untitled Album')
  const [npW, setNpW] = useState('30')
  const [npH, setNpH] = useState('40')
  const [npUnit, setNpUnit] = useState<'cm' | 'in' | 'px'>('cm')
  const [npDpi, setNpDpi] = useState('300')
  const [npPages, setNpPages] = useState('1')
  const booted = useRef(false)
  const canvasRef = useRef<HTMLElement | null>(null)
  const [canvasW, setCanvasW] = useState(800)

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

  const saveProject = async () => {
    if (!project) return
    await api.project.save(project)
  }

  // responsive canvas: track filmstrip container width so page preview scales with window
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

  const openProjectList = async () => {
    const list = await api.project.list()
    setProjectList(list)
    setShowOpenList(v => !v)
  }

  const openProject = async (id: string) => {
    const p = await api.project.get(id)
    if (p) {
      loadProject(p)
      setShowOpenList(false)
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

  const onCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const photoId = e.dataTransfer.getData('text/plain')
    if (!photoId || !page) return
    const rect = (e.currentTarget as HTMLElement).querySelector('svg')?.getBoundingClientRect()
    if (!rect) return
    const SCALE = 0.5
    const x = (e.clientX - rect.left) / SCALE
    const y = (e.clientY - rect.top) / SCALE
    const ph = project?.photos.find(p => p.id === photoId)
    if (!ph) return
    const spec = project!.pageSpec, m = project!.defaultStyle
    const r = ph.width / Math.max(1, ph.height)
    const w = Math.min((spec.width - m.margin * 2) * 0.9, (spec.height - m.margin * 2) * 0.75 * r)
    const h = w / r
    addFrameToPage(page.id, photoId, Math.round(Math.max(m.margin, Math.min(x - w / 2, spec.width - m.margin - w))), Math.round(Math.max(m.margin, Math.min(y - h / 2, spec.height - m.margin - h))), Math.round(w), Math.round(h))
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
    <div className="h-screen flex flex-col bg-neutral-900 text-neutral-100">
      {/* Toolbar */}
      <header className="px-3 py-2 border-b border-neutral-800 flex items-center gap-2 text-sm shrink-0">
        <span className="font-semibold mr-2">PickDeAlbum</span>
        <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600" onClick={() => setShowNewDlg(true)}>New</button>
        <div className="relative">
          <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600" onClick={openProjectList}>Open</button>
          {showOpenList && (
            <div className="absolute top-full left-0 mt-1 bg-neutral-800 border border-neutral-700 rounded shadow-lg z-50 min-w-56 max-h-72 overflow-auto">
              {projectList.length === 0 && <div className="px-3 py-2 text-xs text-neutral-400">No saved projects</div>}
              {projectList.map(p => (
                <button key={p.id} className="block w-full text-left px-3 py-1.5 hover:bg-neutral-700 text-xs truncate"
                  onClick={() => openProject(p.id)}>
                  {p.name}
                  <span className="text-neutral-500 ml-2">{new Date(p.updatedAt).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600" onClick={saveProject}>Save</button>
        <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600" onClick={handleImport}>Import Photos</button>
        <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600" onClick={() => { setShowHome(true) }} title="Back to projects">← Projects</button>
        <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40" onClick={() => handleExport('jpg')} disabled={exporting}>Export JPG</button>
        <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40" onClick={() => handleExport('png')} disabled={exporting}>Export PNG</button>
        <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40" onClick={() => handleExport('pdf')} disabled={exporting}>Export PDF</button>
        <div className="flex-1" />
        <div className="flex items-center gap-1" title="Canvas zoom">
          <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600" onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
          <span className="w-14 text-center text-xs text-neutral-400 select-none">{Math.round(zoom * 100)}%</span>
          <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600" onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}>+</button>
        </div>
        <button className="px-2 py-1 rounded bg-neutral-700 disabled:opacity-40" onClick={undo} disabled={!history.length}>Undo</button>
        <button className="px-2 py-1 rounded bg-neutral-700 disabled:opacity-40" onClick={redo} disabled={!future.length}>Redo</button>
      </header>

      {(photoError || exportMsg) && <div className="px-3 py-1 text-xs text-red-400 bg-red-950/50">{photoError || exportMsg}</div>}

      <main className="flex-1 grid grid-cols-[200px_1fr_240px] overflow-hidden">
        {/* Chapter sidebar */}
        <aside className="border-r border-neutral-800 overflow-auto p-2 text-sm">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-neutral-400 uppercase">Chapters</span>
            <button className="text-xs text-neutral-300 hover:text-white" onClick={addChapter}>+</button>
          </div>
          {project.chapters.map(c => (
            <div key={c.id} className={`px-2 py-1 rounded cursor-pointer flex items-center justify-between ${c.id === ch.id ? 'bg-indigo-600' : 'hover:bg-neutral-800'}`}
              onClick={() => { selectChapter(c.id); if (editingChapterId !== c.id) setEditingChapterId(null) }}>
              {editingChapterId === c.id ? (
                <input autoFocus className="flex-1 bg-neutral-900 border border-indigo-500 rounded px-1 py-0.5 text-xs"
                  defaultValue={c.title}
                  onBlur={e => { renameChapter(c.id, e.target.value || c.title); setEditingChapterId(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  onClick={e => e.stopPropagation()} />
              ) : (
                <span className="truncate" onDoubleClick={e => { e.stopPropagation(); setEditingChapterId(c.id) }}>{c.title}</span>
              )}
              <span className="text-xs text-neutral-300 ml-1">{c.pages.length}p</span>
            </div>
          ))}
          {/* Photo list per chapter */}
          <div className="mt-3">
            <span className="text-xs text-neutral-400 uppercase">Photos</span>
            <div className="mt-1 space-y-0.5">
              {ch.photoRefs.map(pid => {
                const ph = project.photos.find(p => p.id === pid)
                if (!ph) return null
                return (
                  <div key={pid} draggable onDragStart={e => e.dataTransfer.setData('text/plain', pid)} className="px-1 py-0.5 rounded hover:bg-neutral-800 flex items-center gap-1.5 group text-xs cursor-grab">
                    {thumbnails.get(pid) && (
                      <img src={`data:image/webp;base64,${thumbnails.get(pid)}`} alt="" className="w-5 h-5 object-cover rounded shrink-0" />
                    )}
                    <span className="truncate flex-1">{ph.sourcePath?.split(/[\\/]/).pop() ?? pid}</span>
                    <button className="text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100" onClick={() => removePhoto(pid)}>×</button>
                  </div>
                )
              })}
            </div>
          </div>
        </aside>

        {/* Canvas — pages filmstrip */}
        <section ref={canvasRef} className="overflow-auto p-4 flex flex-row flex-wrap gap-3 content-start" onDragOver={e => e.preventDefault()} onDrop={onCanvasDrop}>
          {ch.pages.map((pg, i) => (
            <div key={pg.id} onClick={() => selectPage(pg.id)}
              className={`ring-1 ${pg.id === page.id ? 'ring-indigo-500' : 'ring-transparent'} rounded overflow-hidden`}>
              <div className="text-[10px] text-neutral-400 text-center py-0.5 bg-neutral-800">Page {i + 1} · {pg.frames.length} photo{pg.frames.length === 1 ? '' : 's'}</div>
              <CanvasPage project={project} page={pg} thumbnails={thumbnails}
                  swapTargetId={swapTargetId} onSwap={(a, b) => { swapFrames(pg.id, a, b); setSwapTargetId(null) }}
                  previewW={Math.max(200, Math.round(canvasW * zoom))} />
            </div>
          ))}
        </section>

        {/* Properties panel */}
        <aside className="border-l border-neutral-800 overflow-auto p-3 text-sm space-y-4">
          <div>
            <div className="text-xs text-neutral-400 uppercase mb-1">Auto Layout</div>
            <div className="flex gap-1 mt-1">
              {(['auto', 'single', 'two-up', 'four-up'] as const).map(g => (
                <button key={g} className={`px-2 py-0.5 rounded text-xs ${autoGrid === g ? 'bg-indigo-600' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                  onClick={() => setAutoGrid(g)}>{g}</button>
              ))}
            </div>
            <div className="flex gap-1 mt-1">
              {(['contain', 'cover'] as const).map(f => (
                <button key={f} className={`px-2 py-0.5 rounded text-xs ${autoFit === f ? 'bg-indigo-600' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                  onClick={() => setAutoFit(f)}>
                  {f === 'contain' ? 'Fit (no crop)' : 'Fill (crop)'}
                </button>
              ))}
            </div>
            <button className="mt-2 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 w-full text-sm font-medium"
              onClick={handleAutoLayout} disabled={!ch?.photoRefs.length}>Auto Layout Chapter</button>

            <div className="text-xs text-neutral-400 uppercase mt-4 mb-1">Page</div>
            <div className="text-neutral-300 text-xs">{page.frames.length} frames</div>
            <button className="mt-2 px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 w-full"
              onClick={() => splitPage(ch.id, page.id)}
              disabled={page.frames.length <= 2}>Split page ({page.frames.length} → 2 + rest)</button>
          </div>

          {selectedFrame && (
            <div>
              <div className="text-xs text-neutral-400 uppercase mb-1">Selected Frame</div>
              {([
                ['X', 'x'], ['Y', 'y'], ['W', 'w'], ['H', 'h'],
              ] as const).map(([label, key]) => (
                <label key={key} className="block text-xs">
                  {label} <input type="number" className="w-full mt-0.5 px-1 py-0.5 rounded bg-neutral-800 border border-neutral-700"
                    value={selectedFrame[key]} onChange={e => updateFrame(page.id, selectedFrame.id, { [key]: +e.target.value } as any)} />
                </label>
              ))}
              <label className="block text-xs mt-1">Caption
                <input className="w-full mt-0.5 px-1 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-xs"
                  defaultValue={selectedFrame.caption ?? ''} placeholder="Caption / index…"
                  onBlur={e => { const v = e.target.value; if (v !== (selectedFrame.caption ?? '')) updateFrame(page.id, selectedFrame.id, { caption: v || null }) }} />
              </label>
              <button className="mt-2 px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 w-full"
                onClick={() => setSwapTargetId(swapTargetId === selectedFrame.id ? null : selectedFrame.id)}>
                {swapTargetId === selectedFrame.id ? 'Click a frame to swap with' : 'Swap with another frame…'}
              </button>
              <button className="mt-1 px-2 py-1 rounded bg-red-900/60 hover:bg-red-800 w-full" onClick={() => removeFrame(page.id, selectedFrame.id)}>Remove photo</button>
            </div>
          )}
        </aside>
      </main>

      {/* New Project dialog */}
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