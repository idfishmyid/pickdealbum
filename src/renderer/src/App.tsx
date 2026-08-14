import { useState } from 'react'
import type { LayoutInput, LayoutResult } from '../../../shared/types.js'

const decl = (window as any).electronAPI as {
  layout: { compute: (i: LayoutInput) => Promise<LayoutResult> }
}

export default function App() {
  const [result, setResult] = useState<LayoutResult | null>(null)
  const run = async () => {
    const input: LayoutInput = {
      photos: Array.from({ length: 5 }, (_, i) => ({ id: 'p' + i, width: 3000, height: 4500 })),
      pageSpec: { width: 3035, height: 4054, dpi: 300 },
      margins: { top: 120, right: 120, bottom: 120, left: 120 },
      gap: 20, fitMode: 'contain', noCropPolicy: true,
    }
    setResult(await decl.layout.compute(input))
  }
  return (
    <div className="h-screen flex flex-col bg-neutral-900 text-neutral-100">
      <header className="px-4 py-3 border-b border-neutral-800 flex items-center gap-3">
        <h1 className="font-semibold">PickDeAlbum</h1>
        <button onClick={run} className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500">Compute Layout</button>
        {result && <span className="text-xs text-neutral-400">pages: {result.pages.length} frames: {result.pages.reduce((a, p) => a + p.frames.length, 0)}</span>}
      </header>
      <main className="flex-1 grid grid-cols-[160px_1fr_220px] overflow-hidden">
        <aside className="border-r border-neutral-800 p-2 overflow-auto text-sm">Chapters</aside>
        <section className="overflow-auto p-4 flex gap-3 items-start">
          {(result?.pages ?? []).map((pg) => (
            <div key={pg.id} className="relative bg-white shrink-0 shadow-lg"
              style={{ width: Math.min(3035, 200), aspectRatio: '3035 / 4054' }}>
              {pg.frames.map((f) => (
                <div key={f.id} className="absolute bg-neutral-700"
                  style={{
                    left: `${(f.x / 3035) * 100}%`, top: `${(f.y / 4054) * 100}%`,
                    width: `${(f.w / 3035) * 100}%`, height: `${(f.h / 4054) * 100}%`,
                  }} />
              ))}
            </div>
          ))}
        </section>
        <aside className="border-l border-neutral-800 p-2 overflow-auto text-sm">Properties</aside>
      </main>
    </div>
  )
}
