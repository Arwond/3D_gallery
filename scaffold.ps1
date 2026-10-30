# scaffold.ps1 - add GLB model(s) to the gallery. Windows PowerShell 5.1. Pure ASCII.
#
# Usage:
#   1. Copy one or more .glb files into THIS folder (the project root).
#   2. Run:  .\scaffold.ps1
#      or:  .\scaffold.ps1 -NoPrompt     (skip tag prompts)
#
# What it does:
#   - moves each .glb from the project root into models\<model-id>\
#   - refreshes models.json (keeps existing names, rotations and tags;
#     new models get the default rotation [-90, 0, 120])
#   - prompts for hashtags on every model that does not have a "tags" field
#     yet - including models added before this feature existed
#   - renders models\<model-id>\thumb.jpg for every model that needs one
#     (first loaded view, default rotation) using headless Chrome/Edge
#
# What it does NOT do: it never writes index.html, css\, js\, package.json,
# README.md or any other site file, so your fixes are never overwritten.
# Safe to run any number of times.
param(
    [switch]$NoPrompt
)

$ErrorActionPreference = 'Stop'
[Environment]::CurrentDirectory = $PWD.Path

$DEFAULT_ROTATION = @(-90, 0, 120)

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $fullPath = Join-Path $PWD.Path $Path
    $dir = [System.IO.Path]::GetDirectoryName($fullPath)
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($fullPath, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Normalize-Tag {
    param([string]$Raw)
    if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
    $t = $Raw.Trim().TrimStart('#').ToLowerInvariant()
    $t = $t -replace '\s+', '-'
    $t = $t -replace '[^a-z0-9_-]', ''
    if ([string]::IsNullOrWhiteSpace($t)) { return $null }
    return $t
}

if (-not (Test-Path -LiteralPath "index.html")) {
    Write-Host "ERROR: index.html not found in $(Get-Location)."
    Write-Host "Run this script from the project root (the folder that contains index.html)."
    exit 1
}

New-Item -ItemType Directory -Path "models" -Force | Out-Null

# ---- 1. Move .glb files from the project root into models\<id>\ ---------
$rootGlbs = @(Get-ChildItem -Path . -Filter *.glb -File -ErrorAction SilentlyContinue)
$moved = 0
foreach ($glb in $rootGlbs) {
    $basename = $glb.BaseName
    $modelId  = ($basename.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
    if (-not $modelId) { $modelId = 'model' }

    $targetDir = Join-Path "models" $modelId
    $existing  = @()
    if (Test-Path -LiteralPath $targetDir) {
        $existing = @(Get-ChildItem -Path $targetDir -Filter *.glb -File -ErrorAction SilentlyContinue)
    }
    if ($existing.Count -gt 0) {
        Write-Host "SKIPPED $($glb.Name): models\$modelId already contains $($existing[0].Name)."
        Write-Host "        Rename your file, or run .\remove-model.ps1 $modelId first."
        continue
    }

    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    Move-Item -LiteralPath $glb.FullName -Destination (Join-Path $targetDir $glb.Name)
    Write-Host "Moved $($glb.Name)  ->  models\$modelId\$($glb.Name)"
    $moved++
}

if ($rootGlbs.Count -eq 0) {
    Write-Host "No .glb files in the project root. Refreshing models.json from models\ only."
}

# ---- 2. Refresh models.json --------------------------------------------
$nodeOk       = $null -ne (Get-Command node -ErrorAction SilentlyContinue)
$manifestTool = Test-Path -LiteralPath "scripts\build-manifest.mjs"

if ($nodeOk -and $manifestTool) {
    Write-Host "Running node scripts/build-manifest.mjs ..."
    node scripts/build-manifest.mjs
} else {
    Write-Host "node or scripts\build-manifest.mjs not found - generating models.json by hand."
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

    $prev = @{}
    if (Test-Path -LiteralPath "models.json") {
        try {
            $old = Get-Content "models.json" -Raw | ConvertFrom-Json
            foreach ($m in @($old.models)) {
                if ($m -and $m.id) { $prev[$m.id] = $m }
            }
        } catch {}
    }

    $entries = @()
    foreach ($d in @(Get-ChildItem "models" -Directory -ErrorAction SilentlyContinue | Sort-Object Name)) {
        $glbFile = @(Get-ChildItem $d.FullName -Filter *.glb -File -ErrorAction SilentlyContinue) |
                   Select-Object -First 1
        if (-not $glbFile) { continue }

        $p   = $prev[$d.Name]
        $rot = $DEFAULT_ROTATION
        if ($p -and $p.rotation) { $rot = @($p.rotation | ForEach-Object { [int]$_ }) }
        $nm  = (Get-Culture).TextInfo.ToTitleCase(($d.Name -replace '[-_]+', ' '))
        if ($p -and $p.name) { $nm = [string]$p.name }

        $entries += [pscustomobject]@{
            id       = $d.Name
            name     = $nm
            url      = "models/" + [uri]::EscapeDataString($d.Name) + "/" + [uri]::EscapeDataString($glbFile.Name)
            rotation = $rot
        }
    }

    if ($entries.Count -eq 0) {
        $json = "{`n  `"generatedAt`": `"$stamp`",`n  `"models`": []`n}`n"
    } else {
        $manifest = [pscustomobject]@{ generatedAt = $stamp; models = $entries }
        $json = ($manifest | ConvertTo-Json -Depth 10) + "`n"
    }
    Write-Utf8NoBom "models.json" $json
    Write-Host "Wrote models.json with $($entries.Count) model(s)."
}

# ---- 3. Tag prompt: every model without a "tags" field ----------------
# Reading and updating is done in-memory, then written back as UTF-8 (no BOM).
if (Test-Path -LiteralPath "models.json") {
    try {
        $raw  = Get-Content "models.json" -Raw
        $data = $raw | ConvertFrom-Json

        $needsTags = @()
        foreach ($m in @($data.models)) {
            if ($null -eq $m) { continue }
            if ($null -eq $m.tags) { $needsTags += $m }
        }

        if ($needsTags.Count -gt 0) {
            if ($NoPrompt) {
                Write-Host ""
                Write-Host "Skipping tag prompt (-NoPrompt): $($needsTags.Count) model(s) still untagged."
            } else {
                Write-Host ""
                Write-Host "Tagging $($needsTags.Count) model(s) that do not have tags yet."
                Write-Host "Enter hashtags separated by commas, e.g.: sculpture, artifact, stone"
                Write-Host "The '#' is optional. Spaces inside a tag become hyphens."
                Write-Host "Leave blank to mark the model as intentionally untagged."
                Write-Host ""

                foreach ($m in $needsTags) {
                    Write-Host ("  {0}   [{1}]" -f $m.name, $m.id)
                    $raw2 = Read-Host "    #"
                    $tags = @()
                    if (-not [string]::IsNullOrWhiteSpace($raw2)) {
                        $tags = @(
                            $raw2 -split ',' |
                            ForEach-Object { Normalize-Tag $_ } |
                            Where-Object { $_ } |
                            Select-Object -Unique
                        )
                    }
                    $m | Add-Member -NotePropertyName tags -NotePropertyValue $tags -Force
                    if ($tags.Count -gt 0) {
                        Write-Host ("    -> " + ($tags -join ', '))
                    } else {
                        Write-Host "    -> (no tags)"
                    }
                    Write-Host ""
                }

                $out = ($data | ConvertTo-Json -Depth 10) + "`n"
                Write-Utf8NoBom "models.json" $out
                Write-Host "Updated models.json with tags."
            }
        }
    } catch {
        Write-Host "warning: could not process tags in models.json: $_"
    }
}

# ---- 4. Render thumbnails: models\<id>\thumb.jpg -----------------------
$thumbTool = Test-Path -LiteralPath "scripts\make-thumbnails.mjs"
if ($nodeOk -and $thumbTool) {
    Write-Host ""
    Write-Host "Rendering thumbnails (headless Chrome/Edge) ..."
    node scripts/make-thumbnails.mjs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "warning: thumbnail rendering reported problems."
        Write-Host "         Models without thumb.jpg show 'No preview' in the gallery."
    }
} else {
    Write-Host "Skipping thumbnails: node or scripts\make-thumbnails.mjs not found."
}

Write-Host ""
Write-Host "Done. Moved $moved file(s)."
Write-Host "Preview:  npm run serve   ->  http://localhost:3000"
Write-Host "Publish:  commit and push (git add -A; git commit -m 'add model'; git push)"