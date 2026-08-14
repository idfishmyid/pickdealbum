// One-shot project generator for pickdealbum (Electron + React + Vite + TS).
// Run: node scaffold.mjs   — writes skeleton files (idempotent, skips existing).
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const w = (rel, content, { force = false } = {}) => {
  const p = join(ROOT, rel);
  if (existsSync(p) && !force) return console.log('skip (exists):', rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  console.log('wrote:', rel);
};

w('package.json', JSON.stringify({
  name: 'pickdealbum',
  version: '0.1.0',
  description: 'Desktop photo album designer',
  main: 'out/main/index.js',
  scripts: {
    dev: 'electron-vite dev',
    build: 'electron-vite build',
    preview: 'electron-vite preview',
    'engine:selfcheck': 'node electron/layout-engine.ts',
    dist: 'electron-vite build && electron-builder',
  },
  dependencies: {
    react: '^18.3.1',
    'react-dom': '^18.3.1',
    sharp: '^0.33.5',
    'better-sqlite3': '^11.3.0',
    zustand: '^4.5.5',
  },
  devDependencies: {
    electron: '^32.0.0',
    'electron-vite': '^2.3.0',
    'electron-builder': '^25.0.0',
    '@vitejs/plugin-react': '^4.3.2',
    typescript: '^5.6.2',
    vite: '^5.4.8',
    tailwindcss: '^3.4.13',
    postcss: '^8.4.47',
    autoprefixer: '^10.4.20',
    '@types/react': '^18.3.11',
    '@types/react-dom': '^18.3.0',
    '@types/better-sqlite3': '^7.6.11',
    '@types/node': '^22.7.4',
  },
}, null, 2));

w('tsconfig.json', JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    jsx: 'react-jsx',
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    baseUrl: '.',
    paths: { '@shared/*': ['shared/*'], '@renderer/*': ['src/renderer/src/*'] },
  },
  include: ['src', 'electron', 'shared'],
}, null, 2));

w('electron.vite.config.ts', `import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('src/main/index.ts') } } },
  preload: { build: { rollupOptions: { input: resolve('src/preload/index.ts') } } },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})
`);

w('src/main/index.ts', `import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { computeLayout } from '../../electron/layout-engine.js'
import type { LayoutInput, LayoutResult } from '../../shared/types.js'

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 700,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,      // ponytail: security hard-default
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.once('ready-to-show', () => win?.show())
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// ---- IPC handlers (typed surface; preload mirrors) ----
ipcMain.handle('layout:compute', (_e, input: LayoutInput): LayoutResult => {
  return computeLayout(input)
})

ipcMain.handle('dialog:openDirectory', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
`);

w('src/preload/index.ts', `import { contextBridge, ipcRenderer } from 'electron'
import type { LayoutInput, LayoutResult } from '../../shared/types.js'

// Strict, minimal surface. No ipcRenderer leak.
contextBridge.exposeInMainWorld('electronAPI', {
  layout: {
    compute: (input: LayoutInput) => ipcRenderer.invoke('layout:compute', input),
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  },
} as const)
`);

w('src/renderer/index.html', `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'" />
  <title>PickDeAlbum</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`);

w('src/renderer/src/main.tsx', `import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
`);

w('src/renderer/src/App.tsx', `import { useState } from 'react'
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
                    left: \`\${(f.x / 3035) * 100}%\`, top: \`\${(f.y / 4054) * 100}%\`,
                    width: \`\${(f.w / 3035) * 100}%\`, height: \`\${(f.h / 4054) * 100}%\`,
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
`);

w('src/renderer/src/index.css', `@tailwind base;
@tailwind components;
@tailwind utilities;
`);

w('tailwind.config.js', `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: { extend: {} },
  plugins: [],
}
`);

w('postcss.config.js', `export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
}
`);

w('shared/types.ts', `// Source of truth: electron/layout-engine.ts owns the algorithm types.
// This file mirrors them as the Main ↔ Renderer IPC contract.
export type Fit = 'contain' | 'cover' | 'fill'

export interface Margin { top: number; right: number; bottom: number; left: number }
export interface Photo { id: string; width: number; height: number; orientation?: number }
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
`);

w('.gitignore', `node_modules/
out/
dist/
*.log
.DS_Store
`);

w('README.md', `# PickDeAlbum

Desktop photo album designer (Electron + React + TS + sharp).

## Phase 1
- \`ARCHITECTURE.md\` — system architecture, Main/Renderer split.
- \`DATA-MODEL.md\` — data model + layout engine steps.

## Phase 2
- Project scaffold (electron-vite).
- Layout engine \`electron/layout-engine.ts\` (PackedFit-1) with assert-based self-check.

## Run
\`\`\`bash
pnpm install
pnpm engine:selfcheck   # verify layout engine (no deps needed)
pnpm dev                # launch Electron dev
\`\`\`
`);

console.log('\nscaffold done. next: pnpm install  +  node electron/layout-engine.ts (selfcheck)');
