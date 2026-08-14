/**
 * PickDeAlbum — Project Store (SQLite via better-sqlite3)
 *
 * Schema:
 * - projects: id, name, data_json, created_at, updated_at
 * - thumbnails: photo_id, project_id, data_blob, width, height, mimetype
 * - recent: project_id, last_opened_at
 *
 * Store class with injectable dbPath so self-check runs without Electron.
 */

import Database from 'better-sqlite3'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { Project } from '../shared/types.js'

// app is only available in Electron main process; lazy-resolved so self-check runs without Electron
function resolveElectronApp(): { getPath?: (name: string) => string } | null {
  try {
    const req = createRequire(import.meta.url)
    const electron = req('electron')
    return (electron?.app ?? electron ?? null) as { getPath?: (name: string) => string } | null
  } catch {
    return null
  }
}

export interface ThumbnailData {
  data: Buffer
  width: number
  height: number
  mimetype: string
}

export interface StoredProjectMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

function defaultDbPath(): string {
  const electronApp = resolveElectronApp()
  if (!electronApp || !electronApp.getPath) return join(process.cwd(), 'pickdealbum-test.db')
  return join(electronApp.getPath('userData'), 'pickdealbum.db')
}

export class Store {
  private db: Database.Database

  constructor(dbPath: string = defaultDbPath()) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

      CREATE TABLE IF NOT EXISTS thumbnails (
        photo_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        data BLOB NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        mimetype TEXT NOT NULL,
        PRIMARY KEY (photo_id, project_id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS recent (
        project_id TEXT PRIMARY KEY,
        last_opened_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `)
  }

  close(): void {
    this.db.close()
  }

  createProject(name: string): Project {
    const now = Date.now()
    const id = crypto.randomUUID()
    const project: Project = {
      id, name,
      version: '1.0.0',
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      pageSpec: { width: 3035, height: 4054, dpi: 300, bleed: 30, background: '#FFFFFF' },
      defaultStyle: { margin: 120, gap: 20, frameStroke: 0, frameFill: '#0A0A0A' },
      chapters: [],
      exportSettings: { format: 'jpg', quality: 92, colorProfile: 'sRGB', outputDir: '', flattenTwoPageSpread: false },
    }
    this.db.prepare('INSERT INTO projects (id, name, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, JSON.stringify(project), now, now)
    return project
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT data_json FROM projects WHERE id = ?').get(id) as { data_json: string } | undefined
    if (!row) return null
    this.db.prepare('INSERT INTO recent (project_id, last_opened_at) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET last_opened_at=excluded.last_opened_at').run(id, Date.now())
    return JSON.parse(row.data_json) as Project
  }

  listProjects(): StoredProjectMeta[] {
    return this.db.prepare('SELECT id, name, created_at, updated_at FROM projects ORDER BY updated_at DESC').all() as StoredProjectMeta[]
  }

  saveProject(project: Project): void {
    const now = Date.now()
    project.updatedAt = new Date(now).toISOString()
    this.db.prepare('UPDATE projects SET name = ?, data_json = ?, updated_at = ? WHERE id = ?')
      .run(project.name, JSON.stringify(project), now, project.id)
    this.db.prepare('INSERT INTO recent (project_id, last_opened_at) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET last_opened_at=excluded.last_opened_at').run(project.id, now)
  }

  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM thumbnails WHERE project_id = ?').run(id)
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }

  getRecentProjects(): { id: string; name: string; lastOpenedAt: number }[] {
    return this.db.prepare('SELECT p.id, p.name, r.last_opened_at FROM recent r JOIN projects p ON p.id = r.project_id ORDER BY r.last_opened_at DESC LIMIT 10').all() as { id: string; name: string; lastOpenedAt: number }[]
  }

  setThumbnail(projectId: string, photoId: string, thumb: ThumbnailData): void {
    this.db.prepare('INSERT INTO thumbnails (photo_id, project_id, data, width, height, mimetype) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(photo_id, project_id) DO UPDATE SET data=excluded.data, width=excluded.width, height=excluded.height, mimetype=excluded.mimetype')
      .run(photoId, projectId, thumb.data, thumb.width, thumb.height, thumb.mimetype)
  }

  getThumbnail(projectId: string, photoId: string): ThumbnailData | null {
    const row = this.db.prepare('SELECT data, width, height, mimetype FROM thumbnails WHERE photo_id = ? AND project_id = ?').get(photoId, projectId) as ThumbnailData | undefined
    return row ?? null
  }
}

// ---------------------------------------------------------------------------
// self-check — runnable without Electron: node electron/project-store.ts
// ---------------------------------------------------------------------------

function selfCheck() {
  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error('STORE SELF-CHECK FAIL: ' + msg) }
  const store = new Store(':memory:')

  const p = store.createProject('Test Project')
  assert(p.id && p.name === 'Test Project', 'createProject returns project')

  const got = store.getProject(p.id)
  assert(got && got.id === p.id, 'getProject retrieves')

  const list = store.listProjects()
  assert(list.some(x => x.id === p.id), 'listProjects includes')

  p.name = 'Renamed'
  store.saveProject(p)
  const updated = store.getProject(p.id)
  assert(updated?.name === 'Renamed', 'saveProject persists')

  const recents = store.getRecentProjects()
  assert(recents.some(r => r.id === p.id), 'recent tracked')

  const thumb: ThumbnailData = { data: Buffer.from('fake'), width: 100, height: 100, mimetype: 'image/webp' }
  store.setThumbnail(p.id, 'photo1', thumb)
  const t2 = store.getThumbnail(p.id, 'photo1')
  assert(t2 && t2.width === 100, 'thumbnail roundtrip')

  store.deleteProject(p.id)
  assert(store.getProject(p.id) === null, 'deleteProject removes')

  store.close()
  console.log('STORE SELF-CHECK PASS: all operations work')
}

if (process.argv[1] && import.meta.url === import.meta.resolve(process.argv[1])) {
  selfCheck()
}