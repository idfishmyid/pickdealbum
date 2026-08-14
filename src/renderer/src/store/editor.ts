/**
 * Zustand store — editor state + frame ops + undo/redo.
 * Snapshot-based history (project is JSON-serializable, scale is small).
 */

import { create } from 'zustand'
import type { Project, Chapter, Page, Frame, Photo } from '../../../shared/types.js'

let uidCounter = 0
const uid = (p: string) => `${p}_${(Date.now().toString(36))}_${(uidCounter++).toString(36)}`

const snapshot = (p: Project): Project => JSON.parse(JSON.stringify(p))

function makeProject(opts: { name?: string; width?: number; height?: number; dpi?: number } = {}): Project {
  const now = new Date().toISOString()
  const chId = uid('ch')
  return {
    id: uid('prj'), name: opts.name || 'Untitled Album', version: '1.0.0', createdAt: now, updatedAt: now,
    pageSpec: { width: opts.width || 3035, height: opts.height || 4054, dpi: opts.dpi || 300, bleed: 30, background: '#FFFFFF' },
    defaultStyle: { margin: 120, gap: 20, frameStroke: 0, frameFill: '#0A0A0A' },
    chapters: [{ id: chId, title: 'Chapter 1', order: 0, photoRefs: [], pages: [{ id: uid('pg'), frames: [] }] }],
    exportSettings: { format: 'jpg', quality: 92, colorProfile: 'sRGB', outputDir: '', flattenTwoPageSpread: false },
    photos: [],
  }
}

function findPage(project: Project, pageId: string): { chapter: Chapter; page: Page } | null {
  for (const ch of project.chapters) {
    const page = ch.pages.find(p => p.id === pageId)
    if (page) return { chapter: ch, page }
  }
  return null
}

/** Place a new frame at (x,y) sized to fit page content area, cascade offset. */
export function placeFrame(p: Project, page: Page, photo: Photo): Frame {
  const spec = p.pageSpec, m = p.defaultStyle
  const cw = spec.width - m.margin * 2
  const ch = spec.height - m.margin * 2
  const r = photo.width / Math.max(1, photo.height)
  const w = Math.min(cw * 0.92, ch * 0.75 * r)
  const h = w / r
  const n = page.frames.length
  const x = m.margin + (n % 2) * (cw / 2 - w / 2)
  const y = m.margin + Math.floor(n / 2) * (ch / 2 - h / 2)
  return {
    id: uid('fr'), photoId: photo.id,
    x: Math.round(Math.min(x, spec.width - m.margin - w)),
    y: Math.round(Math.min(y, spec.height - m.margin - h)),
    w: Math.round(w), h: Math.round(h),
    rotation: 0, zIndex: n, crop: { ox: 0, oy: 0, cx: 1, cy: 1 }, fit: 'contain',
  }
}

export interface HistoryEntry {
  label: string
  undo: () => void
  redo: () => void
}

interface EditorState {
  project: Project | null
  currentChapterId: string | null
  selectedFrameId: string | null
  currentPageId: string | null
  history: HistoryEntry[]
  future: HistoryEntry[]

  loadProject: (p: Project) => void
  newProject: (opts?: { name?: string; width?: number; height?: number; dpi?: number }) => void
  addChapter: () => void
  renameChapter: (id: string, title: string) => void
  selectChapter: (id: string) => void
  selectPage: (id: string) => void
  selectFrame: (id: string | null) => void
  addPhotos: (photos: Photo[]) => void
  removePhoto: (photoId: string) => void

  addFrameToPage: (pageId: string, photoId: string, x: number, y: number, w: number, h: number) => void
  updateFrame: (pageId: string, frameId: string, patch: Partial<Frame>) => void
  swapFrames: (pageId: string, a: string, b: string) => void
  removeFrame: (pageId: string, frameId: string) => void
  splitPage: (chapterId: string, pageId: string) => void
  replaceChapterPages: (chapterId: string, pages: Page[]) => void

  undo: () => void
  redo: () => void
}

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  currentChapterId: null,
  selectedFrameId: null,
  currentPageId: null,
  history: [],
  future: [],

  loadProject: (p) => {
    const copy = snapshot(p)
    set({
      project: copy,
      currentChapterId: p.chapters[0]?.id ?? null,
      currentPageId: p.chapters[0]?.pages[0]?.id ?? null,
      selectedFrameId: null, history: [], future: [],
    })
  },

  newProject: (opts) => {
    const p = makeProject(opts)
    set({ project: p, currentChapterId: p.chapters[0].id, currentPageId: p.chapters[0].pages[0].id, selectedFrameId: null, history: [], future: [] })
  },

  addChapter: () => set(s => {
    if (!s.project) return s
    const p = snapshot(s.project)
    p.chapters.push({ id: uid('ch'), title: `Chapter ${p.chapters.length + 1}`, order: p.chapters.length, photoRefs: [], pages: [{ id: uid('pg'), frames: [] }] })
    return { project: p }
  }),

  renameChapter: (id, title) => set(s => {
    if (!s.project) return s
    const p = snapshot(s.project)
    const ch = p.chapters.find(c => c.id === id)
    if (ch) ch.title = title
    return { project: p }
  }),

  selectChapter: (id) => set(s => {
    if (!s.project) return s
    const ch = s.project.chapters.find(c => c.id === id)
    return { currentChapterId: id, currentPageId: ch?.pages[0]?.id ?? null, selectedFrameId: null }
  }),

  selectPage: (id) => set({ currentPageId: id, selectedFrameId: null }),
  selectFrame: (id) => set({ selectedFrameId: id }),

  addPhotos: (photos) => set(s => {
    if (!s.project) return s
    const p = snapshot(s.project)
    p.photos.push(...photos.map(ph => ({ ...ph })))
    const ch = p.chapters.find(c => c.id === s.currentChapterId) ?? p.chapters[0]
    if (ch) {
      ch.photoRefs.push(...photos.map(ph => ph.id))
      const page = ch.pages[ch.pages.length - 1]
      if (page) for (const ph of photos) page.frames.push(placeFrame(p, page, ph))
    }
    return { project: p }
  }),

  removePhoto: (photoId) => set(s => {
    if (!s.project) return s
    const p = snapshot(s.project)
    p.photos = p.photos.filter(ph => ph.id !== photoId)
    for (const ch of p.chapters) {
      ch.photoRefs = ch.photoRefs.filter(id => id !== photoId)
      for (const pg of ch.pages) pg.frames = pg.frames.filter(f => f.photoId !== photoId)
    }
    return { project: p }
  }),

  // ---- history helper: wrap a mutation ----

  addFrameToPage: (pageId, photoId, x, y, w, h) => {
    const s = get()
    const before = s.project ? snapshot(s.project) : null
    set(prev => {
      if (!prev.project) return prev
      const p = snapshot(prev.project)
      const loc = findPage(p, pageId)
      if (!loc) return prev
      loc.page.frames.push({ id: uid('fr'), photoId, x, y, w, h, rotation: 0, zIndex: loc.page.frames.length, crop: { ox: 0, oy: 0, cx: 1, cy: 1 }, fit: 'contain' })
      return { project: p, selectedFrameId: loc.page.frames[loc.page.frames.length - 1].id }
    })
    const after = get().project
    if (before && after) {
      get().history.push({ label: 'Add photo', undo: () => set({ project: before }), redo: () => set({ project: after }) })
      get().future.length = 0
    }
  },

  updateFrame: (pageId, frameId, patch) => {
    const s = get()
    const before = s.project ? snapshot(s.project) : null
    set(prev => {
      if (!prev.project) return prev
      const p = snapshot(prev.project)
      const loc = findPage(p, pageId)
      if (!loc) return prev
      const f = loc.page.frames.find(f => f.id === frameId)
      if (f) Object.assign(f, patch)
      return { project: p }
    })
    const after = get().project
    if (before && after) {
      get().history.push({ label: 'Update', undo: () => set({ project: before }), redo: () => set({ project: after }) })
      get().future.length = 0
    }
  },

  swapFrames: (pageId, a, b) => {
    const s = get()
    const before = s.project ? snapshot(s.project) : null
    set(prev => {
      if (!prev.project) return prev
      const p = snapshot(prev.project)
      const loc = findPage(p, pageId)
      if (!loc) return prev
      const fa = loc.page.frames.find(f => f.id === a)
      const fb = loc.page.frames.find(f => f.id === b)
      if (fa && fb) { const t = fa.photoId; fa.photoId = fb.photoId; fb.photoId = t }
      return { project: p }
    })
    const after = get().project
    if (before && after) {
      get().history.push({ label: 'Swap photos', undo: () => set({ project: before }), redo: () => set({ project: after }) })
      get().future.length = 0
    }
  },

  removeFrame: (pageId, frameId) => {
    const s = get()
    const before = s.project ? snapshot(s.project) : null
    set(prev => {
      if (!prev.project) return prev
      const p = snapshot(prev.project)
      const loc = findPage(p, pageId)
      if (!loc) return prev
      loc.page.frames = loc.page.frames.filter(f => f.id !== frameId)
      return { project: p, selectedFrameId: null }
    })
    const after = get().project
    if (before && after) {
      get().history.push({ label: 'Remove', undo: () => set({ project: before }), redo: () => set({ project: after }) })
      get().future.length = 0
    }
  },

  splitPage: (chapterId, pageId) => {
    const s = get()
    const before = s.project ? snapshot(s.project) : null
    set(prev => {
      if (!prev.project) return prev
      const p = snapshot(prev.project)
      const ch = p.chapters.find(c => c.id === chapterId)
      if (!ch) return prev
      const idx = ch.pages.findIndex(pg => pg.id === pageId)
      if (idx < 0) return prev
      const src = ch.pages[idx]
      if (src.frames.length <= 2) return prev
      const rest = { id: uid('pg'), frames: src.frames.slice(2) }
      src.frames = src.frames.slice(0, 2)
      ch.pages.splice(idx + 1, 0, rest)
      return { project: p }
    })
    const after = get().project
    if (before && after) {
      get().history.push({ label: 'Split page', undo: () => set({ project: before }), redo: () => set({ project: after }) })
      get().future.length = 0
    }
  },

  replaceChapterPages: (chapterId, pages) => {
    const s = get()
    const before = s.project ? snapshot(s.project) : null
    set(prev => {
      if (!prev.project) return prev
      const p = snapshot(prev.project)
      const ch = p.chapters.find(c => c.id === chapterId)
      if (!ch) return prev
      ch.pages = pages
      return { project: p, currentPageId: pages[0]?.id ?? null }
    })
    const after = get().project
    if (before && after) {
      get().history.push({ label: 'Auto layout', undo: () => set({ project: before }), redo: () => set({ project: after }) })
      get().future.length = 0
    }
  },

  undo: () => {
    const s = get()
    const cmd = s.history[s.history.length - 1]
    if (!cmd) return
    cmd.undo()
    set({ history: s.history.slice(0, -1), future: [...s.future, cmd] })
  },

  redo: () => {
    const s = get()
    const cmd = s.future[s.future.length - 1]
    if (!cmd) return
    cmd.redo()
    set({ history: [...s.history, cmd], future: s.future.slice(0, -1) })
  },
}))