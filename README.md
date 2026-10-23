# 3D Model Gallery (GLB)

Static three.js viewer for GLB models, hosted on GitHub Pages.
No build step: GitHub Pages just serves these files.

## Layout

    index.html
    css/style.css
    js/main.js
    models.json              <- list of models (generated, see below)
    models/<model-id>/<file>.glb
    models/<model-id>/thumb.jpg
    scripts/build-manifest.mjs
    scripts/make-thumbnails.mjs
    tools/thumb.html         <- used only by make-thumbnails.mjs (local)
    tools/thumb.js
    scaffold.ps1             <- add models + thumbnails (Windows)
    remove-model.ps1         <- remove models (Windows)

## Adding a model

Easiest (Windows PowerShell):

1. Copy the `.glb` file(s) into the project root.
2. Run `.\scaffold.ps1`. It moves each file into `models\<model-id>\`, refreshes
   `models.json`, and renders `models\<model-id>\thumb.jpg`. New models get the
   default rotation `[-90, 0, 120]`.
3. Commit and push.

Manual: put the `.glb` in `models/<model-id>/`, then run `npm run manifest`
and `npm run thumbs`.

`scaffold.ps1` only handles models. It never rewrites `index.html`, `css/`, `js/` or
any other site file.

## Thumbnails

`npm run thumbs` (also called by `scaffold.ps1`) renders each model's first view
with its configured rotation to `models/<id>/thumb.jpg` (640x480 JPEG).

It drives a real headless Chrome or Edge for WebGL, so no native modules are
needed. Supported browsers are auto-detected (Chrome/Edge on Windows and macOS,
google-chrome/chromium on Linux). Set `CHROME_PATH` to override:

    $env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
    npm run thumbs

`thumb.jpg` is only re-rendered when it is older than the `.glb`. Force a full
re-render with:

    node scripts/make-thumbnails.mjs --force

If no browser is found, models without a thumbnail simply show "No preview"
in the gallery.

## Removing a model

    .\remove-model.ps1            # pick from a list
    .\remove-model.ps1 byl2       # remove by folder id

It deletes the model folder - the `.glb` and its `thumb.jpg` go together - after
you type `yes`, and refreshes `models.json`.

## File name case

File names are **case-sensitive on GitHub Pages**. `Byl1.glb` and `byl1.glb` are
different files there, even though Windows treats them as the same.

## Fixing a model's orientation

Use the Rot X / Rot Y / Rot Z buttons in the viewer, then **Copy rot** and paste
the result into that model's `"rotation"` in `models.json`. Delete
`models/<id>/thumb.jpg` (or run `npm run thumbs -- --force`) so the thumbnail is
re-rendered with the new rotation.

## Gallery and navigation

The front page shows the models as a paginated thumbnail grid (25 per page).
The page number lives in the URL (`#/page/3`), so the browser Back button - and
the mouse back button - return you to the exact page and scroll position you
opened the model from.

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