# remove-model.ps1 - delete a model folder and refresh models.json
# Usage:
#   .\remove-model.ps1              # interactive - pick from a list
#   .\remove-model.ps1 byl2         # remove the model whose folder id is "byl2"
param(
    [Parameter(Position = 0)]
    [string]$ModelId
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

# Ensures every entry in models.json has a "rotation" array.
# If missing, sets it to $DEFAULT_ROTATION. Never overrides an existing one.
function Ensure-Rotations {
    if (-not (Test-Path "models.json")) { return }
    try {
        $data    = Get-Content "models.json" -Raw | ConvertFrom-Json
        $changed = $false
        foreach ($m in @($data.models)) {
            if ($null -eq $m) { continue }
            if ($null -eq $m.rotation) {
                $m | Add-Member -NotePropertyName rotation `
                                -NotePropertyValue $DEFAULT_ROTATION `
                                -Force
                $changed = $true
            }
        }
        if ($changed) {
            $json = ($data | ConvertTo-Json -Depth 10) + "`n"
            Write-Utf8NoBom "models.json" $json
            Write-Host "Post-processed models.json: added default rotation [-90, 0, 120] to entries that were missing it."
        }
    } catch {
        Write-Host "warning: could not post-process models.json: $_"
    }
}

if (-not (Test-Path -LiteralPath "models")) {
    Write-Host "ERROR: no 'models' folder in $(Get-Location)"
    exit 1
}

$available = @(Get-ChildItem -Path "models" -Directory | Sort-Object Name)
if ($available.Count -eq 0) {
    Write-Host "No model folders found under models\."
    exit 0
}

# ---- Determine which model to remove ----
$targetId = $null

if (-not [string]::IsNullOrWhiteSpace($ModelId)) {
    if (-not ($available | Where-Object { $_.Name -eq $ModelId })) {
        Write-Host "ERROR: model '$ModelId' not found. Available:"
        $available | ForEach-Object { Write-Host "  - $($_.Name)" }
        exit 1
    }
    $targetId = $ModelId
} else {
    Write-Host "Available models:"
    for ($i = 0; $i -lt $available.Count; $i++) {
        $folder = $available[$i]
        $glb = @(Get-ChildItem -Path $folder.FullName -Filter *.glb -File -ErrorAction SilentlyContinue)
        $sizeMb = if ($glb.Count -gt 0) { [math]::Round($glb[0].Length / 1MB, 2) } else { 0 }
        Write-Host ("  [{0}] {1}  ({2} MB)" -f ($i + 1), $folder.Name, $sizeMb)
    }
    Write-Host ""
    $choice = Read-Host "Enter number or model id to remove (blank to cancel)"
    if ([string]::IsNullOrWhiteSpace($choice)) { Write-Host "Cancelled."; exit 0 }

    $n = 0
    if ([int]::TryParse($choice, [ref]$n) -and $n -ge 1 -and $n -le $available.Count) {
        $targetId = $available[$n - 1].Name
    } elseif ($available | Where-Object { $_.Name -eq $choice }) {
        $targetId = $choice
    } else {
        Write-Host "ERROR: '$choice' is neither a valid number nor a known model id."
        exit 1
    }
}

# ---- Sanity check: target must be inside models/ ----
$targetPath     = Join-Path "models" $targetId
$resolvedModels = (Resolve-Path "models").Path.TrimEnd('\', '/')
$resolvedTarget = (Resolve-Path $targetPath).Path

$sep = [System.IO.Path]::DirectorySeparatorChar
if (-not ($resolvedTarget + $sep).StartsWith($resolvedModels + $sep)) {
    Write-Host "ERROR: refusing to delete outside the models folder: $resolvedTarget"
    exit 1
}

# ---- Confirm ----
$files   = @(Get-ChildItem -LiteralPath $resolvedTarget -Recurse -File -ErrorAction SilentlyContinue)
$totalMb = if ($files.Count -gt 0) {
    [math]::Round((($files | Measure-Object -Property Length -Sum).Sum / 1MB), 2)
} else { 0 }

Write-Host ""
Write-Host "About to delete:"
Write-Host "  $resolvedTarget"
Write-Host "  ($($files.Count) file(s), $totalMb MB)"
$confirm = Read-Host "Type 'yes' to confirm"
if ($confirm -ne 'yes') {
    Write-Host "Cancelled."
    exit 0
}

Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
Write-Host "Deleted $targetPath"

# ---- Regenerate models.json ----
$nodeOk       = $null -ne (Get-Command node -ErrorAction SilentlyContinue)
$manifestTool = Test-Path "scripts\build-manifest.mjs"

if ($nodeOk -and $manifestTool) {
    Write-Host "Regenerating models.json with node ..."
    node scripts/build-manifest.mjs
} else {
    Write-Host "node or scripts\build-manifest.mjs not found - updating models.json by hand."
    $stamp   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $entries = @()

    if (Test-Path "models.json") {
        try {
            $existing = Get-Content "models.json" -Raw | ConvertFrom-Json
            foreach ($m in @($existing.models)) {
                if ($m -and $m.id -and $m.id -ne $targetId) { $entries += $m }
            }
        } catch {
            Write-Host "warning: could not parse existing models.json, writing empty list"
        }
    }

    if ($entries.Count -eq 0) {
        $json = "{`n  `"generatedAt`": `"$stamp`",`n  `"models`": []`n}`n"
    } else {
        $objects = @()
        foreach ($e in $entries) {
            $o = [ordered]@{
                id   = [string]$e.id
                name = [string]$e.name
                url  = [string]$e.url
            }
            if ($null -ne $e.rotation) {
                $o.rotation = @($e.rotation | ForEach-Object { [int]$_ })
            }
            $objects += [pscustomobject]$o
        }
        $manifest = [pscustomobject]@{
            generatedAt = $stamp
            models      = $objects
        }
        $json = ($manifest | ConvertTo-Json -Depth 10) + "`n"
    }

    Write-Utf8NoBom "models.json" $json
    Write-Host "Wrote models.json with $($entries.Count) model(s)."
}

# ---- Self-healing: any entry missing rotation gets the default ----
Ensure-Rotations

Write-Host ""
Write-Host "Done. Removed: $targetId"
