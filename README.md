# PickDeAlbum

Desktop photo album designer (Electron + React + TS + sharp).

## Phase 1
- `ARCHITECTURE.md` — system architecture, Main/Renderer split.
- `DATA-MODEL.md` — data model + layout engine steps.

## Phase 2
- Project scaffold (electron-vite).
- Layout engine `electron/layout-engine.ts` (PackedFit-1) with assert-based self-check.

## Run
```bash
pnpm install
pnpm engine:selfcheck   # verify layout engine (no deps needed)
pnpm dev                # launch Electron dev
```
