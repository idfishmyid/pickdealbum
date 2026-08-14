import { contextBridge, ipcRenderer } from 'electron'
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
