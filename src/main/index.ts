import { app, BrowserWindow, ipcMain, dialog } from 'electron'
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
