# Photo Album Designer - System Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ELECTRON APPLICATION                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────┐    IPC (contextBridge)    ┌──────────┐│
│  │      MAIN PROCESS            │ ◄────────────────────────► │ RENDERER ││
│  │      (Node.js / Electron)    │      Secure, typed        │  PROCESS ││
│  │                              │                            │ (React)  ││
│  ├──────────────────────────────┤                            ├──────────┤│
│  │ Responsibilities:            │                            │ Responsib││
│  │ • File system access         │                            │ • UI/UX  ││
│  │ • Image processing (sharp)   │                            │ • State  ││
│  │ • High-res export (JPG/PDF)  │                            │   mgmt   ││
│  │ • Project persistence        │                            │ • Drag-  ││
│  │ • Native dialogs             │                            │   drop   ││
│  │ • Window management          │                            │ • Canvas ││
│  │ • Auto-updater               │                            │   render ││
│  └──────────────────────────────┘                            └──────────┘│
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Main Process Responsibilities

### 1. File System & Project Persistence
- **Project CRUD**: Create, open, save, save-as project files (`.album` JSON)
- **Photo Import**: Scan directories, read metadata (EXIF, dimensions), generate thumbnails
- **Recent Projects**: Maintain recent projects list in user config

### 2. Image Processing (sharp)
- **Thumbnail Generation**: Create low-res previews for UI (200-400px max dimension)
- **High-Res Export**:
  - Compose pages at print resolution (300 DPI)
  - Apply transforms: resize, crop, rotate, color space conversion
  - Output: JPG (quality 90-95), PDF (multi-page)
- **Color Management**: sRGB → CMYK conversion for print labs (optional)

### 3. Layout Engine (Core Algorithm)
- **Input**: Array of photos + page constraints (size, margins, gaps)
- **Output**: Page layouts with positioned frames (x, y, w, h, rotation)
- **Algorithm**: Bin packing / constraint solver for pixel-perfect fit
- **Runs in Main** to avoid blocking UI thread

### 4. Secure IPC (contextBridge)
```typescript
// preload.ts - Exposed APIs
contextBridge.exposeInMainWorld('electronAPI', {
  // Project
  project: { create, open, save, saveAs, getRecent },
  // Photos
  photos: { importFromDir, getThumbnail, getMetadata },
  // Layout
  layout: { computeAutoLayout, exportHighRes },
  // System
  dialog: { showOpenDialog, showSaveDialog },
  // Events
  on: { projectSaved, exportProgress, layoutComputed }
})
```

---

## Renderer Process Responsibilities

### 1. UI State Management (React + TypeScript)
- **Project State**: Current project, chapters, photos, pages
- **UI State**: Selection, tool mode, zoom, panel visibility
- **History**: Undo/redo stack for manual edits

### 2. Components
```
App
├── ProjectBar          # New/Open/Save, project name
├── ChapterSidebar      # Chapter list, drag-reorder chapters
├── PhotoBrowser        # Thumbnail grid, drag source
├── Canvas              # Page preview, drop target, frame manipulation
│   ├── PageThumbnail   # Mini page preview in filmstrip
│   └── FrameOverlay    # Resize handles, swap, delete
├── PropertiesPanel     # Margin, padding, gap, alignment per page
└── ExportDialog        # Format, DPI, output location
```

### 3. Manual Editor Interactions
- **Drag-Drop**: PhotoBrowser → Canvas (create frame), Canvas → Canvas (move/swap)
- **Frame Resize**: Corner/edge handles with aspect ratio lock
- **Frame Swap**: Click two frames → swap images
- **Page Settings**: Per-page margin, padding, gap, auto-fit toggle

### 4. Canvas Rendering
- **SVG or Canvas API**: Render page layout at screen resolution
- **Virtualized Filmstrip**: Only render visible page thumbnails
- **Zoom/Pan**: Transform matrix for detail work

---

## Data Flow

### Project Create / Open
```
User → Renderer: "New Project" / "Open Project"
    → Main: dialog.showOpenDialog() → file path
    → Main: read .album JSON → parse → validate
    → Main: generate thumbnails for all photos (background)
    → IPC: projectLoaded { project, thumbnails }
    → Renderer: setProjectState()
```

### Auto Layout Compute
```
User → Renderer: "Auto Layout Chapter X"
    → Renderer: collect photos + page constraints
    → IPC: layout.computeAutoLayout({ photos, pageSize, margins, gap })
    → Main: run layout algorithm (Worker thread if heavy)
    → IPC: layoutComputed { pages: Frame[][] }
    → Renderer: applyLayoutToState()
```

### High-Res Export
```
User → Renderer: "Export" (format, DPI, path)
    → IPC: exportHighRes({ project, pages, format, dpi, outputPath })
    → Main: for each page → sharp compose → write file
    → IPC: exportProgress { current, total }
    → Main: done → IPC: exportComplete { outputFiles }
    → Renderer: show success notification
```

---

## Security Model

| Aspect | Implementation |
|--------|----------------|
| Context Isolation | `contextIsolation: true`, `nodeIntegration: false` |
| IPC | `contextBridge` with typed API, no `ipcRenderer` in Renderer |
| File Access | Main process only, validated paths, no arbitrary read/write |
| CSP | Strict CSP: `script-src 'self'; object-src 'none'` |
| Preload | Single preload script, minimal exposed surface |

---

## Tech Stack Summary

| Layer | Technology | Reason |
|-------|------------|--------|
| Framework | Electron 28+ | Mature, secure IPC, auto-updater |
| Frontend | React 18 + TypeScript | Type safety, ecosystem |
| Styling | Tailwind CSS | Utility-first, fast iteration |
| State | Zustand or Redux Toolkit | Simple, performant |
| Canvas | Fabric.js or Konva | Object model for frames, interaction |
| Image Proc | sharp (Main) | Fast, streaming, low memory |
| Layout Algo | Custom (bin-packing) | Pixel-perfect, no-crop constraint |
| Build | Vite + electron-builder | Fast dev, signed distributables |

---

## Directory Structure

```
pickdealbum/
├── electron/
│   ├── main.ts           # Main process entry
│   ├── preload.ts        # Secure IPC bridge
│   ├── layout-engine.ts  # Auto-layout algorithm
│   ├── image-processor.ts# sharp wrapper
│   ├── project-store.ts  # JSON/SQLite persistence
│   └── ipc-handlers.ts   # IPC route definitions
├── src/
│   ├── components/       # React components
│   ├── hooks/            # Custom hooks
│   ├── store/            # State management
│   ├── types/            # Shared TypeScript types
│   └── utils/            # Helpers
├── shared/
│   └── types.ts          # Types shared Main ↔ Renderer
├── package.json
└── vite.config.ts
```

---

## Next Steps (Phase 1 Deliverables)

1. ✅ This architecture document
2. ⬜ JSON Schema for Project / Layout / Frame data models
3. ⬜ IPC TypeScript contracts (shared types)
4. ⬜ Layout engine algorithm specification
