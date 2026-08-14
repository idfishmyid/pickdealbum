import { contextBridge, ipcRenderer } from 'electron'
import type { LayoutInput, LayoutResult, Project } from '../../shared/types.js'

// Strict, minimal surface. No ipcRenderer leak.
contextBridge.exposeInMainWorld('electronAPI', {
  project: {
    create: (name: string) => ipcRenderer.invoke('project:create', name),
    get: (id: string) => ipcRenderer.invoke('project:get', id),
    save: (project: Project) => ipcRenderer.invoke('project:save', project),
    delete: (id: string) => ipcRenderer.invoke('project:delete', id),
    list: () => ipcRenderer.invoke('project:list'),
    recent: () => ipcRenderer.invoke('project:recent'),
  },
  photos: {
    importFromDir: (dir: string) => ipcRenderer.invoke('photos:importFromDir', dir),
    importFiles: (files: string[]) => ipcRenderer.invoke('photos:importFiles', files),
    makeThumbnail: (projectId: string, photoId: string, srcPath: string) => ipcRenderer.invoke('photos:makeThumbnail', projectId, photoId, srcPath),
    getThumbnail: (projectId: string, photoId: string) => ipcRenderer.invoke('photos:getThumbnail', projectId, photoId),
  },
  layout: {
    compute: (input: LayoutInput) => ipcRenderer.invoke('layout:compute', input),
  },
  export: {
    highRes: (project: Project, srcMap: Record<string, string>, format: 'jpg' | 'pdf', outputPath: string) =>
      ipcRenderer.invoke('export:highRes', project, srcMap, format, outputPath),
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
    saveFile: (defaultName: string) => ipcRenderer.invoke('dialog:saveFile', defaultName),
  },
} as const)
