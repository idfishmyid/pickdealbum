/**
 * App — main editor shell. Toolbar (new/save/undo/redo), chapter sidebar,
 * photo browser, page canvas, properties panel. Phase 4a: frames are
 * placeholders; drag-drop/resize/swap wired to store.
 */

import { useEffect, useState } from 'react'
import type { Project } from '../../../shared/types.js'
import { useEditor } from './store/editor.js'
import { CanvasPage } from './components/CanvasPage.js'

const api = (window as any).electronAPI as {
  project: { create: (n: string) => Promise<Project>; save: (p: Project) => Promise<void> }
  dialog: { openFiles: () => Promise<string[]> }
  photos: { importFiles: (f: string[]) => Promise<{ id: string; sourcePath: string }[]> }
}

export default function App() {
  const {
    project, currentChapterId, currentPageId, selectedFrameId,
    history, future, newProject, addChapter, selectChapter,
    addPhotos, removePhoto, selectPage, selectFrame, updateFrame, removeFrame, splitPage, undo, redo,
  } = useEditor()
  const [photoError, setPhotoError] = useState('')
  const booted = useRef(false)

  // init: new project on mount (persist wiring comes later)
  useEffect(() => { if (!booted.current && !project) { booted.current = true; newProject() } }, [])

  const saveProject = async () => {
    if (!project) return
    await api.project.save(project)
  }

  const handleImport = async () => {
    setPhotoError('')
    const files = await api.dialog.openFiles()
    if (!files.length) return
    const imported = await api.photos.importFiles(files)
    if (!imported.length) return
    // read dims later via sharp; fallback 4:3
    addPhotos(imported.map(p => ({ id: p.id, width: 3000, height: 2000, sourcePath: p.sourcePath })))
  }

  const ch = project?.chapters.find(c => c.id === currentChapterId) ?? project?.chapters[0]
  const page = ch?.pages.find(p => p.id === currentPageId) ?? ch?.pages[0]
  const selectedFrame = page?.frames.find(f => f.id === selectedFrameId)

  if (!project || !ch || !page) return <div className="h-screen bg-neutral-900 text-neutral-200 flex items-center justify-center">Loading…</div>

  return (
    <div className="h-screen flex flex-col bg-neutral-900 text-neutral-100">
      {/* Toolbar */}
      <header className="px-3 py-2 border-b border-neutral-800 flex items-center gap-2 text-sm shrink-0">
        <span className="font-semibold mr-2">PickDeAlbum</span>
        <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600" onClick={newProject}>New</button>
        <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600" onClick={saveProject}>Save</button>
        <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600" onClick={handleImport}>Import Photos</button>
        <div className="flex-1" />
        <button className="px-2 py-1 rounded bg-neutral-700 disabled:opacity-40" onClick={undo} disabled={!history.length}>Undo</button>
        <button className="px-2 py-1 rounded bg-neutral-700 disabled:opacity-40" onClick={redo} disabled={!future.length}>Redo</button>
      </header>

      {photoError && <div className="px-3 py-1 text-xs text-red-400 bg-red-950/50">{photoError}</div>}

      <main className="flex-1 grid grid-cols-[200px_1fr_240px] overflow-hidden">
        {/* Chapter sidebar */}
        <aside className="border-r border-neutral-800 overflow-auto p-2 text-sm">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-neutral-400 uppercase">Chapters</span>
            <button className="text-xs text-neutral-300 hover:text-white" onClick={addChapter}>+</button>
          </div>
          {project.chapters.map(c => (
            <div key={c.id} className={`px-2 py-1 rounded cursor-pointer flex items-center justify-between ${c.id === ch.id ? 'bg-indigo-600' : 'hover:bg-neutral-800'}`}
              onClick={() => selectChapter(c.id)}>
              <span className="truncate">{c.title}</span>
              <span className="text-xs text-neutral-300">{c.pages.length}p</span>
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
                  <div key={pid} className="px-2 py-0.5 rounded hover:bg-neutral-800 flex items-center justify-between group text-xs">
                    <span className="truncate">{ph.sourcePath?.split(/[\\/]/).pop() ?? pid}</span>
                    <button className="text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100" onClick={() => removePhoto(pid)}>×</button>
                  </div>
                )
              })}
            </div>
          </div>
        </aside>

        {/* Canvas — pages filmstrip */}
        <section className="overflow-auto p-4 flex flex-col gap-3 items-start">
          {ch.pages.map((pg, i) => (
            <div key={pg.id} onClick={() => selectPage(pg.id)}
              className={`ring-1 ${pg.id === page.id ? 'ring-indigo-500' : 'ring-transparent'} rounded overflow-hidden`}>
              <div className="text-[10px] text-neutral-400 text-center py-0.5 bg-neutral-800">Page {i + 1} · {pg.frames.length} photo{pg.frames.length === 1 ? '' : 's'}</div>
              <CanvasPage project={project} page={pg} />
            </div>
          ))}
        </section>

        {/* Properties panel */}
        <aside className="border-l border-neutral-800 overflow-auto p-3 text-sm space-y-4">
          <div>
            <div className="text-xs text-neutral-400 uppercase mb-1">Page</div>
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
              <button className="mt-2 px-2 py-1 rounded bg-red-900/60 hover:bg-red-800 w-full" onClick={() => removeFrame(page.id, selectedFrame.id)}>Remove photo</button>
            </div>
          )}
        </aside>
      </main>
    </div>
  )
}