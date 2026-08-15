/**
 * AppLayout — album-design app shell (AlbumTeller/SmartAlbums style).
 * Pure visual structure; interaction wiring deferred. Light theme.
 *
 * Regions:
 *  - TopNav: project name + dims (left), undo/redo (center), proofing/export (right)
 *  - FloatingToolbar: vertical icon rail, left of canvas (Shuffle/Gap/Padding/Border/Mode/Align/Split)
 *  - SpreadView: maximal center canvas, two facing pages + spine
 *  - PhotoTray: bottom horizontal filmstrip + chapter tabs
 */
import type { ReactNode } from 'react'

// ponytail: icons are placeholder glyphs; swap for lucide-react if added later
const Tool = ({ label, glyph }: { label: string; glyph: string }) => (
  <button
    title={label}
    aria-label={label}
    className="w-10 h-10 flex items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 transition-colors"
  >
    <span className="text-lg leading-none select-none">{glyph}</span>
  </button>
)

const Divider = () => <div className="w-6 h-px bg-neutral-200 my-1 mx-auto" />

export function AppLayout({
  projectName = 'Untitled Album',
  sheetInfo = '30×21 / 5 Sheets',
  toolbar = null,
  pages = null,        // <SpreadView/> node pair
  photoTray = null,    // <PhotoTray/> node
  chapterTabs = null,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onExport,
  onProofing,
  notice = null,
}: {
  projectName?: string
  sheetInfo?: string
  toolbar?: ReactNode
  pages?: ReactNode
  photoTray?: ReactNode
  chapterTabs?: ReactNode
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  onExport?: () => void
  onProofing?: () => void
  notice?: ReactNode
}) {
  return (
    <div className="h-screen w-screen flex flex-col bg-gray-100 text-neutral-800 overflow-hidden">
      {/* ===== Top Navigation Bar ===== */}
      <header className="h-12 shrink-0 bg-white border-b border-gray-200 flex items-center px-4 gap-4 select-none">
        {/* left: project identity + dimensions */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">📔</span>
          <span className="font-medium text-sm truncate">{projectName}</span>
          <span className="text-xs text-gray-400 hidden sm:inline">/</span>
          <span className="text-xs text-gray-500 truncate">{sheetInfo}</span>
        </div>

        {/* center: undo / redo */}
        <div className="mx-auto flex items-center gap-1">
          <button className="w-8 h-8 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent" title="Undo" onClick={onUndo} disabled={!canUndo}>↶</button>
          <button className="w-8 h-8 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent" title="Redo" onClick={onRedo} disabled={!canRedo}>↷</button>
        </div>

        {/* right: primary actions */}
        <div className="flex items-center gap-2">
          <button className="px-3 h-8 text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50" onClick={onProofing}>Proofing</button>
          <button className="px-3 h-8 text-sm rounded-md bg-neutral-800 text-white hover:bg-neutral-700" onClick={onExport}>Export</button>
        </div>
      </header>

      {notice && <div className="shrink-0 px-4 py-1 text-xs text-red-600 bg-red-50 border-b border-red-100">{notice}</div>}

      {/* ===== Body: toolbar + canvas (flex) ===== */}
      <div className="flex-1 flex min-h-0">
        {/* Floating toolbar — vertical rail, overlaid left of canvas */}
        <nav
          aria-label="Tools"
          className="z-10 w-12 shrink-0 bg-white/90 backdrop-blur border-r border-gray-200 flex flex-col items-center py-2 gap-0.5"
        >
          {toolbar ?? (
            <>
              <Tool label="Shuffle" glyph="⇄" />
              <Tool label="Gap" glyph="↔" />
              <Tool label="Padding" glyph="▯" />
              <Divider />
              <Tool label="Border" glyph="▭" />
              <Tool label="Mode" glyph="◐" />
              <Divider />
              <Tool label="Align" glyph="⫟" />
              <Tool label="Split" glyph="‖" />
            </>
          )}
        </nav>

        {/* Spread canvas — maximal */}
        <main className="flex-1 min-w-0 flex items-center justify-center overflow-auto p-8">
          {pages ?? <SpreadView />}
        </main>
      </div>

      {/* ===== Bottom Photo Tray ===== */}
      <footer className="shrink-0 bg-white border-t border-gray-200 flex flex-col">
        {/* chapter tabs */}
        <div className="flex items-center gap-1 px-2 border-b border-gray-100 overflow-x-auto">
          {chapterTabs ?? (
            <>
              <ChapterTab label="Chapter 1" active />
              <ChapterTab label="Chapter 2" />
              <button className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-700">＋</button>
            </>
          )}
        </div>

        {/* filmstrip */}
        <div className="h-28 overflow-x-auto overflow-y-hidden flex items-center gap-2 px-3 py-2">
          {photoTray ?? (
            <>
              {Array.from({ length: 8 }).map((_, i) => (
                <Thumb key={i} label={`IMG_${i + 1}`} />
              ))}
            </>
          )}
        </div>
      </footer>
    </div>
  )
}

/** Spread view — two facing pages with a book spine down the middle. */
export function SpreadView() {
  return (
    <div className="flex shadow-xl rounded-sm overflow-hidden" style={{ filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.12))' }}>
      {/* left page */}
      <PagePaper side="left" />
      {/* spine */}
      <div className="w-px bg-gray-300 relative z-10">
        <div className="absolute inset-y-0 -left-px w-2 -translate-x-1 bg-gradient-to-r from-black/10 to-transparent" />
        <div className="absolute inset-y-0 right-px w-2 translate-x-px bg-gradient-to-l from-black/10 to-transparent" />
      </div>
      {/* right page */}
      <PagePaper side="right" />
    </div>
  )
}

function PagePaper({ side }: { side: 'left' | 'right' }) {
  return (
    <div
      className="bg-white relative"
      style={{ width: 480, height: 320 }}
      aria-label={`${side} page`}
    >
      {/* subtle shadow so page reads as physical paper */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ boxShadow: side === 'left' ? 'inset 8px 0 12px -8px rgba(0,0,0,0.15)' : 'inset -8px 0 12px -8px rgba(0,0,0,0.15)' }}
      />
      <div className="absolute top-1 left-1 text-[10px] text-gray-300 select-none">{side}</div>
    </div>
  )
}

const ChapterTab = ({ label, active }: { label: string; active?: boolean }) => (
  <button className={`px-3 py-1.5 text-xs whitespace-nowrap border-b-2 ${active ? 'border-neutral-800 text-neutral-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
    {label}
  </button>
)

const Thumb = ({ label }: { label: string }) => (
  <div
    className="shrink-0 w-20 h-20 rounded border border-gray-200 bg-gray-50 hover:border-neutral-400 cursor-pointer flex items-end p-1"
    title={label}
  >
    <span className="text-[9px] text-gray-400 truncate">{label}</span>
  </div>
)