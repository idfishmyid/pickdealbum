import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname } from 'node:path'
import { promises as fs, readdirSync } from 'node:fs'
import { computeLayout } from '../../electron/layout-engine.js'
import { Store } from '../../electron/project-store.js'
import { makeThumbnail, exportPage, exportPdf } from '../../electron/image-processor.js'
import type { LayoutInput, LayoutResult, Project, PageSpec } from '../../shared/types.js'

const store = new Store()
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

const IMAGES_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic'])

// ---- IPC: project store ----
ipcMain.handle('project:create', (_e, name: string): Project => store.createProject(name))
ipcMain.handle('project:get', (_e, id: string): Project | null => store.getProject(id))
ipcMain.handle('project:save', (_e, project: Project): void => store.saveProject(project))
ipcMain.handle('project:delete', (_e, id: string): void => store.deleteProject(id))
ipcMain.handle('project:list', () => store.listProjects())
ipcMain.handle('project:recent', () => store.getRecentProjects())

// ---- IPC: photo import ----
ipcMain.handle('photos:importFromDir', (_e, dir: string) => {
  const files = readdirSync(dir).filter(f => IMAGES_EXT.has(extname(f).toLowerCase()))
  return files.map(f => ({ id: crypto.randomUUID(), sourcePath: join(dir, f) }))
})

ipcMain.handle('photos:importFiles', (_e, files: string[]) => {
  return files.filter(f => IMAGES_EXT.has(extname(f).toLowerCase()))
    .map(f => ({ id: crypto.randomUUID(), sourcePath: f }))
})

// ---- IPC: thumbnails ----
ipcMain.handle('photos:makeThumbnail', async (_e, projectId: string, photoId: string, srcPath: string) => {
  const thumb = await makeThumbnail(srcPath)
  store.setThumbnail(projectId, photoId, thumb)
  return { width: thumb.width, height: thumb.height }
})

ipcMain.handle('photos:getThumbnail', (_e, projectId: string, photoId: string) => {
  const t = store.getThumbnail(projectId, photoId)
  return t ? { data: t.data.toString('base64'), width: t.width, height: t.height, mimetype: t.mimetype } : null
})

// ---- IPC: layout engine ----
ipcMain.handle('layout:compute', (_e, input: LayoutInput): LayoutResult => computeLayout(input))

// ---- IPC: high-res export ----
ipcMain.handle('export:highRes', async (_e, project: Project, srcMap: Record<string, string>, format: 'jpg' | 'pdf', outputPath: string) => {
  const resolver = (photoId: string) => srcMap[photoId] ?? ''
  const pages = project.chapters.flatMap(ch => ch.pages)
  const spec: PageSpec = { width: project.pageSpec.width, height: project.pageSpec.height, dpi: project.pageSpec.dpi }
  const bg = project.pageSpec.background

  if (format === 'pdf') {
    const buf = await exportPdf(pages, spec, resolver, bg)
    await fs.writeFile(outputPath, buf)
    return { path: outputPath, bytes: buf.length }
  }
  const results = []
  for (const p of pages) {
    const r = await exportPage(p.id, p.frames, spec, resolver, bg, project.exportSettings.quality)
    const out = join(outputPath, `${p.id}.jpg`)
    await fs.writeFile(out, r.buffer)
    results.push({ path: out, bytes: r.buffer.length })
  }
  return results
})

// ---- IPC: native dialogs ----
ipcMain.handle('dialog:openDirectory', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('dialog:openFiles', async () => {
  const r = await dialog.showOpenDialog(win!, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff'] }],
  })
  return r.canceled ? [] : r.filePaths
})

ipcMain.handle('dialog:saveFile', async (_e, defaultName: string) => {
  const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName })
  return r.canceled ? null : r.filePath
})
