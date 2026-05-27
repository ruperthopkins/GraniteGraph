# Assets

Reference images and sample materials used in development and documentation.

**Image files are gitignored** — only the directory structure is tracked. Copy files into these folders locally; they will not be committed to the repository. Large raw scan batches belong in the separate `granite-graph-media/` working folder (see below).

## Directory structure

```
assets/
  maps/
    plot-map/      Seaview Cemetery hand-drawn plot map scans
    gis/           GIS screenshots, exported rasters, QGIS project files
  sources/
    samples/       2–3 representative pages per source, used to develop
                   and test AI extraction prompts
      mallmann/
      church-records/
      white/
      tillotson/
      edna-cards/
  screenshots/     App UI screenshots used in documentation or design decisions
```

## Naming convention

```
{source}_{identifier}_{sequence}.jpg

Examples:
  mallmann_hopkins_p001.jpg
  edna_card_0042_front.jpg
  edna_card_0042_back.jpg
  seaview_plotmap_full.jpg
  seaview_gis_aerial_2024.jpg
```

## Local working folder

Raw scan batches and bulk materials that are too large for the repo belong in a
parallel local folder outside the project directory:

```
granite-graph-media/
  maps/
    raw-scans/       Full-resolution map scans
    gis/             QGIS project files and layer exports
  sources/
    mallmann/        All Mallmann page scans (by page number)
    church-records/  Scanned church record images
    white/           White genealogy scans
    tillotson/       Tillotson genealogy scans
    edna-cards/
      front/         Front of each card
      back/          Back of each card
  field/             Local backup of stone photos (authoritative copy in Supabase)
  working/           Ad hoc screenshots and unsorted materials
```
