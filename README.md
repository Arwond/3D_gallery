# 3D Model Gallery (GLB)

Static three.js viewer for GLB models, hosted on GitHub Pages.
No build step: GitHub Pages just serves these files.

## Layout

    index.html
    css/style.css
    js/main.js
    models.json              <- list of models (generated, see below)
    models/<model-id>/<file>.glb
    scripts/build-manifest.mjs
    scaffold.ps1             <- add models (Windows)
    remove-model.ps1         <- remove models (Windows)

## Adding a model

Easiest (Windows PowerShell):

1. Copy the `.glb` file(s) into the project root.
2. Run `.\scaffold.ps1`. It moves each file into `models\<model-id>\` and refreshes
   `models.json`. New models get the default rotation `[-90, 0, 120]`.
3. Commit and push.

Manual: put the `.glb` in `models/<model-id>/`, then run `npm run manifest`.

`scaffold.ps1` only handles models. It never rewrites `index.html`, `css/`, `js/` or
any other site file.

## Removing a model

    .\remove-model.ps1            # pick from a list
    .\remove-model.ps1 byl2       # remove by folder id

It deletes the model folder (after you type `yes`) and refreshes `models.json`.

## File name case

File names are **case-sensitive on GitHub Pages**. `Byl1.glb` and `byl1.glb` are
different files there, even though Windows treats them as the same.

## Fixing a model's orientation

Use the Rot X / Rot Y / Rot Z buttons in the viewer, then **Copy rot** and paste
the result into that model's `"rotation"` in `models.json`.

## Local preview

    npm run serve

The viewer uses `fetch()` and ES modules, so it must be served over HTTP.
Opening `index.html` directly (file://) will not work.

## Deploy

1. Push this folder's contents to the **root** of a GitHub repo (branch `main`).
2. Settings -> Pages -> Deploy from a branch -> `main` -> `/ (root)`.
3. Site appears at `https://<user>.github.io/<repo>/`.

`.nojekyll` stops GitHub from running Jekyll on the files.

## Large GLBs

- GitHub rejects any single file over 100 MB (warns above 50 MB).
- Shrink with: `npx @gltf-transform/cli optimize in.glb out.glb`
  (Draco and Meshopt compressed files are supported by the viewer.)
- Keep the whole repo comfortably under 1 GB (Pages limit).
