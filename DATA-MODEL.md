# Photo Album Designer - Data Model & JSON Schema

Schema data inti + urutan langkah layout engine. Semua angka dalam **px** (CSS pixel) jika tidak dinyatakan lain. Eksport resolusi tinggi mengalikan `px * (DPI / 96)`.

---

## 1. Project (`*.album`)

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "id": "Project",
  "version": "1.0.0",
  "name": "Wisuda Anak Budi",
  "createdAt": "2026-08-14T10:30:00.000Z",   // ISO 8601 UTC
  "updatedAt": "2026-08-14T11:45:00.000Z",
  // Global page spec — semua page mewarisi ini
  "pageSpec": {
    "width": 3035,        // px (30cm @ 300DPI ≈ A4 portrait)
    "height": 4054,
    "dpi": 300,
    "bleed": 30,          // px bleed di luar trim
    "background": "#FFFFFF"
  },
  "defaultStyle": {
    "margin": 120,        // px margin page (canvas)
    "gap": 20,            // px gap antar frame
    "frameStroke": 0,     // px border foto
    "frameFill": "#0A0A0A"
  },
  "chapters": [ /* Chapter[] */ ],
  "exportSettings": {
    "format": "jpg",      // "jpg" | "pdf" | "tiff"
    "quality": 92,        // jpg 1-100
    "colorProfile": "sRGB",
    "outputDir": "/Users/name/Exports",
    "flattenTwoPageSpread": false
  }
}
```

**Field rules:**
- `version`: semver string. migrasi saat load jika < current.
- `pageSpec.width/height` termasuk bleed.
- `defaultStyle` = nilai default, bisa di-override per `Page` & per `Frame`.

---

## 2. Chapter (Bab)

```jsonc
{
  "id": "ch_01",                  // ULID unik
  "title": "Persiapan",
  "order": 0,
  "photoRefs": ["ph_a1", "ph_a2"], // foto milik chapter
  "pages": [ /* Page[] */ ],
  "styleOverride": {              // nullable, merge atas defaultStyle
    "background": "#F5F5F0"
  }
}
```

---

## 3. Page (Halaman)

```jsonc
{
  "id": "pg_01",
  "chapterId": "ch_01",
  "order": 0,
  "layout": "auto",              // "auto" | "manual" | "spread"
  "frames": [ /* Frame[] */ ],
  "styleOverride": {
    "margin": 100,
    "gap": 16
  },
  "margin": {                    // per-sisi px, override styleOverride.margin
    "top": 120, "right": 120, "bottom": 120, "left": 120
  }
}
```

---

## 4. Frame (box foto di page)

Satu frame = satu foto yang sudah ditempatkan. **Inilah output utama layout engine.**

```jsonc
{
  "id": "fr_01",
  "photoId": "ph_a1",           // ref ke Photo
  // posisi & ukuran DALAM page (px, quadran top-left)
  "x": 120, "y": 120,
  "w": 1397, "h": 1900,
  "rotation": 0,                 // deg, 0/90/180/270
  "zIndex": 0,
  // crop relatif terhadap foto asli (0..1) — mencegah crop sembarangan
  "crop": {
    "ox": 0.0, "oy": 0.0,        // offset titik mulai crop
    "cx": 1.0, "cy": 1.0         // lebar/tinggi crop (1.0 = full)
  },
  "fit": "contain",             // "contain" | "cover" | "fill"
  "strokeWidth": 0,
  "strokeColor": "#FFFFFF",
  "cornerRadius": 0,            // px
  "shadow": null,               // { blur, color, ox, oy } | null
  "caption": null                // string | null
}
```

**Invariant:** `crop.cx * photoW ≤ frame.w` (dengan faktor DPI) — engine menjamin **tidak memotong lebih dari yang user izinkan**. Default `crop.cx=cy=1.0` = tampilkan seluruh foto, `fit:"contain"` = letterbox alih-alih crop.

---

## 5. Photo (inventaris foto)

```jsonc
{
  "id": "ph_a1",
  "sourcePath": "/photos/IMG_0001.jpg",  // path disk absolut
  "thumbnailPath": "cache://ph_a1.webp", // path thumbnail yang di-generate sharp
  "width": 4000,    // px asli
  "height": 6000,
  "orientation": 1, // EXIF orientation 1-8
  "meta": {
    "takenAt": "2026-07-01T08:15:00Z",
    "cameraMake": "Canon", "cameraModel": "EOS R6"
  },
  "colorLabel": "none"  // "none"|"red"|"green"|"blue"|"yellow"
}
```

Photos disimpan terpisah dari frames: satu foto bisa muncul di banyak frame, dan urutan import independen dari layout.

---

## 6. Layout Engine — Langkah Algoritma

Layout engine = pipeline stateless: input → output `Page[]` dengan `Frame[]` terisi. Berjalan di Main process (opsional Worker thread).

```jsonc
{
  "engine": "PackedFit-1",
  "steps": [
    {
      "step": 1, "name": "normalize-photos",
      "desc": "Baca dimensi asli tiap Photo, normalisasi orientasi EXIF. Hitung aspect ratio r=w/h, kelompokkan foto jadi pool berurutan per chapter."
    },
    {
      "step": 2, "name": "split-spread",
      "desc": "Tentukan mode page: single (1 foto/side) atau spread (2 page). Bagi pool foto jadi batch per page sesuai count est. Estimasi count = floor((pageW*pageH) / (avgPhotoArea)) diberi kap."
    },
    {
      "step": 3, "name": "compute-grid",
      "desc": "Pilih tipe grid berdasar rasio dominan foto: '1-up'(1), '2-up-v'(2 vertikal), '2-up-h'(2 horizontal), '3-up', '4-up', 'mosaic'. Hitung slotCells yang memenuhi columnConstraint: cell.w/cell.h mendekati rasio foto median (clustering r dalam ±15%)."
    },
    {
      "step": 4, "name": "bin-pack",
      "desc": "Guillotine/MaxRects bin-packing: tempatkan tiap foto ke slot. Aturan no-crop: cari slot dengan area ≥ foto*fitFactor; jika tidak muat, singkirkan ke page berikutnya alih-alih crop. Sisa area kosong = background page, bukan crop foto."
    },
    {
      "step": 5, "name": "fit-frame",
      "desc": "Untuk tiap slot terisi, hitung crop opsional hanya jika rasio foto ≠ rasio slot DAN fit:'cover': crop minimal memotong sisi terpanjang berdasar rule-of-thirds center. Default fit:'contain' = tidak crop sama sekali."
    },
    {
      "step": 6, "name": "apply-spacing",
      "desc": "Tempatkan frame di dalam margin page. Gap ditarik dari Page.styleOverride.gap atau Project.defaultStyle.gap. Kurangi x/y tiap frame dengan offset margin; pastikan frame bersisian tidak overlap dengan gap = background terlihat."
    },
    {
      "step": 7, "name": "balance",
      "desc": "Seimbangkan distribusi whitespace: jika page terakhir setengah kosong, distribusikan ulang foto antar page (mode 'rebalance') supaya gap rata. Opsional, flag autoBalance bool."
    },
    {
      "step": 8, "name": "paint",
      "desc": "Output Page[] dengan Frame[] terisi (x,y,w,h,crop,fit,zIndex). Kirim via IPC ke Renderer untuk render preview."
    }
  ]
}
```

### 6.1 Parameter input engine
```jsonc
{
  "photos": ["ph_a1", "ph_a2"],
  "pageSpec": { "width": 3035, "height": 4054 },
  "margins": { "top": 120, "right": 120, "bottom": 120, "left": 120 },
  "gap": 20,
  "preferGrid": "auto",     // "auto"|"single"|"two-up"|"four-up"
  "autoBalance": true,
  "fitMode": "contain",     // default fit, bisa di-override per frame di step 5
  "noCropPolicy": true      // true = tidak pernah crop; crop hanya bila fit:'cover'
}
```

### 6.2 Output engine
```jsonc
{
  "pages": [
    { "id":"pg_01","frames":[ {/*Frame*/}, {/*Frame*/} ] }
  ],
  "warnings": [
    { "pageId":"pg_03","message":"1 foto tidak muat, dipindah ke page baru" }
  ]
}
```

---

## 7. Undo/Redo (selisih state)

Bukan full snapshot — diff per aksi, disimpan di Renderer. Tiap entry = `target` + `before` + `after` JSON patch (RFC 6902 compact).

```jsonc
{
  "action": "frame.resize",
  "target": "pg_01/fr_02",
  "before": { "w": 1000, "h": 1400 },
  "after":  { "w": 1100, "h": 1540 },
  "ts": "2026-08-14T11:46:00.000Z"
}
```

---

## 8. Penyimpanan (persistensi)

| Dimensi | Pilihan | Catatan |
|---------|---------|---------|
| Skema kecil (<50 foto) | file `.album` + `thumbnails.json` | JSON tunggal, zip-friendly bila dipadukan dengan thumbnail |
| Skala besar (500+ foto) | SQLite (`better-sqlite3`) | Tabel: `projects`, `chapters`, `pages`, `frames`, `photos`. file foto asli tetap referensi path |

**Rekomendasi Phase 1:** mulai SQLite via `better-sqlite3` (synchronous, simpel, cepat) — schema JSON di atas langsung jadi kolom JSON di tabel, tetap fleksibel. `.album` = ekspor genggam, bukan penyimpanan kerja.

---

## 9. IPC TypeScript contracts (intisari)

`shared/types.ts`:
```typescript
export interface Project        { id:string; name:string; version:string; /* ... */ }
export interface Chapter        { id:string; title:string; photoRefs:string[]; pages:Page[] }
export interface Page           { id:string; frames:Frame[]; margin:Margin; layout:'auto'|'manual'|'spread' }
export interface Frame          { id:string; photoId:string; x:number;y:number;w:number;h:number; crop:CropRect; fit:'contain'|'cover'|'fill' }
export interface Photo          { id:string; sourcePath:string; width:number; height:number; thumbnailPath:string }
export interface LayoutInput    { photos:string[]; pageSpec:PageSpec; margins:Margin; gap:number; fitMode:'contain'|'cover' }
export interface LayoutResult   { pages:RenderPage[]; warnings:Warning[] }
```
