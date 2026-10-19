# scaffold.ps1 - add GLB model(s) to the gallery. Windows PowerShell 5.1. Pure ASCII.
#
# Usage:
#   1. Copy one or more .glb files into THIS folder (the project root).
#   2. Run:  .\scaffold.ps1
#
# What it does:
#   - moves each .glb from the project root into models\<model-id>\
#   - refreshes models.json (keeps existing names and tuned rotations;
#     new models get the default rotation [-90, 0, 120])
#
# What it does NOT do: it never writes index.html, css\, js\, package.json,
# README.md or any other site file, so your fixes are never overwritten.
# Safe to run any number of times.
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

Write-Host ""
Write-Host "Done. Moved $moved file(s)."
Write-Host "Preview:  npm run serve   ->  http://localhost:3000"
Write-Host "Publish:  commit and push (git add -A; git commit -m 'add model'; git push)"
