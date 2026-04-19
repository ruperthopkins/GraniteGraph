# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Granite Graph is a cemetery volunteer data collection and genealogy application for documenting historic gravestone inscriptions and building a family relationship graph. It is focused on the Church of Christ at Old Man's cemetery in Mount Sinai, Long Island, NY, with church records spanning 1778–1839.

## Commands

```bash
npm start          # Dev server at localhost:3000
npm run build      # Production build → /build
npm test           # Jest + React Testing Library (watch mode)
npm test -- --watchAll=false  # Single test run
```

API endpoints in `/api/` are Vercel serverless functions — they run server-side in production but are not served by `npm start`. Test them via Vercel CLI or deployed preview.

## Architecture

**Stack**: React 19 SPA + Supabase (Postgres/Auth) + Vercel serverless API + Gemini AI (image OCR) + Claude (text extraction)

### Core Volunteer Workflow (`src/Home.js`)

The primary feature: a multi-phase gravestone documentation flow for field use.

1. **LANDING** → choose workflow
2. **PHOTOGRAPH CAPTURE** → device camera, GPS waits for ≤10m accuracy
3. **MATRIX REVIEW** → Gemini extracts people/dates/kinship from photo; volunteer confirms
4. **MATCH PHASE** → each extracted person is matched against the `deceased` database
5. **DONE** → saves stone, photos, stone_deceased links, kinship relationships, activity_log

Central state is `stoneMatrix`: `{ stone_condition, stone_notes, people: [{geminiData, correctedName, role, relationships, matchedRecord, matchStatus, ...}] }`

### AI Integration (`/api/`)

- **`/api/analyze.js`** — Sends base64 JPEG to Gemini 2.5 Flash; returns structured JSON of people, dates, stone condition. Temperature 0.1 for transcription consistency.
- **`/api/extract.js`** — Sends historical document text to Claude Sonnet; returns people + relationships arrays with confidence levels. Token limit 16,000.

### Admin Tools (`src/admin/`)

- **`ChurchImport.jsx`** — Extracts genealogy data from historical church records using Claude. Manages pre-chunked document sets, supports custom text paste, generates SQL for batch Supabase inserts. Color-coded by event type (joined/dismissed/excommunicated) and relationship type.
- **`PersonView.jsx`** — QA and curation tool: loads a person record, shows linked stones/photos, edits metadata, manages kinship relationships with confidence/source tracking.

### Database (Supabase/Postgres)

Key tables: `deceased`, `stones`, `stone_deceased` (junction), `stone_photos`, `kinship`, `volunteer_profiles`, `activity_log`.

- `kinship` stores directed relationships; two rows are inserted for bidirectional pairs (e.g., PARENT_OF + CHILD_OF).
- `stones.location` is a PostGIS point; use the `get_stones_with_coordinates()` RPC to retrieve lat/lng.
- `v_deceased_search` is a view with occupancy status used by `Search.js`.
- Cemetery ID `d8bd1f88-cdde-4ef2-a448-5ab04d2d8107` is hardcoded throughout for Mount Sinai.

### UI Patterns

- Tailwind utility classes, dark theme (`bg-gray-900`, `green-400` accents), high-contrast for outdoor field use.
- State management is local React hooks only — no Redux or Context.
- Images are resized to max 1024px before sending to Gemini (cost/speed).

## Environment Variables

| Variable | Used by |
|---|---|
| `REACT_APP_SUPABASE_URL` | Frontend (`supabaseClient.js`) |
| `REACT_APP_SUPABASE_ANON_KEY` | Frontend |
| `REACT_APP_GEMINI_KEY` | Frontend (direct Gemini calls) |
| `GEMINI_KEY` | `/api/analyze.js` (server-side) |
| `ANTHROPIC_API_KEY` | `/api/extract.js` (server-side) |
