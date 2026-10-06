# Fastcal (POC)

Yazio-helyettesítő gyors kalórianapló — EU/HU, Expo + TypeScript + SQLite/FTS5 + Open Food Facts.

## Scope

- 1 képernyős napló + fix alsó sáv (kcal + P/Z/Sz)
- Gyors felvitel: tegnap ugyanez / gyakori / legutóbbi
- Kereső (helyi FTS → OFF) + EAN (OFF + cache)
- Gramszerkesztés, nap/étkezés másolás
- Offline-first: USDA seed + saját/előzmény a telefonon; net csak ismeretlen EAN/kereséshez

**Nincs:** regisztráció, onboarding, szerver backend, AI-fotó, OCR, böjt, recept

## Futtatás

```bash
cd /workspace/fastcal
npm start          # Expo — QR / a = Android
npm run android    # emulator (AVD kell)
npm run web        # böngésző (SQLite wasm)
```

Telefon: Expo Go (Play) + ugyanaz a Wi‑Fi + QR.

## Kontraktus

`src/types.ts` → `DataApi`. Implementáció: `src/data/sqliteStore.ts` (mock: `mockStore.ts` megmaradt referenciának).
