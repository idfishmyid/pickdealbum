// Source of truth: electron/layout-engine.ts owns the algorithm types.
// This file mirrors them as the Main ↔ Renderer IPC contract.
export type Fit = 'contain' | 'cover' | 'fill'

export interface Margin { top: number; right: number; bottom: number; left: number }
export interface Photo { id: string; width: number; height: number; orientation?: number; sourcePath?: string }
export interface PageSpec { width: number; height: number; dpi?: number; bleed?: number }
export interface CropRect { ox: number; oy: number; cx: number; cy: number }
export interface Frame {
  id: string; photoId: string
  x: number; y: number; w: number; h: number
  rotation: number; zIndex: number
  crop: CropRect; fit: Fit
}
export interface RenderPage { id: string; frames: Frame[] }
export interface Warning { pageId: string; message: string }
export interface LayoutInput {
  photos: Photo[]; pageSpec: PageSpec
  margins: Margin; gap: number
  preferGrid?: 'auto' | 'single' | 'two-up' | 'four-up'
  autoBalance?: boolean
  fitMode?: Fit; noCropPolicy?: boolean
}
export interface LayoutResult { pages: RenderPage[]; warnings: Warning[] }

// Project persistence types
export interface ExportSettings {
  format: 'jpg' | 'pdf' | 'tiff'
  quality: number
  colorProfile: string
  outputDir: string
  flattenTwoPageSpread: boolean
}

export interface DefaultStyle {
  margin: number
  gap: number
  frameStroke: number
  frameFill: string
}

export interface Chapter {
  id: string
  title: string
  order: number
  photoRefs: string[]
  pages: RenderPage[]
  styleOverride?: Partial<DefaultStyle>
}

export interface Project {
  id: string
  name: string
  version: string
  createdAt: string
  updatedAt: string
  pageSpec: PageSpec & { background: string }
  defaultStyle: DefaultStyle
  chapters: Chapter[]
  exportSettings: ExportSettings
  photos: Photo[]
}
