// Regenerate models.json by scanning models/ for .glb files.
// Run locally:  npm run manifest      (GitHub Pages never runs this)
// Keeps any custom "name", "rotation" and "tags" you already set in models.json.
import { readdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const MODELS_DIR       = 'models';
const OUT_FILE         = 'models.json';
const DEFAULT_ROTATION = [-90, 0, 120];
const GITHUB_LIMIT_MB  = 100;

const prettyName = (id) =>
  id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

async function main() {
  const previous = {};
  try {
    const parsed = JSON.parse(await readFile(OUT_FILE, 'utf8'));
    if (Array.isArray(parsed.models)) {
      for (const m of parsed.models) if (m && m.id) previous[m.id] = m;
    }
  } catch { /* first run or unreadable file */ }

  let entries;
  try {
    entries = await readdir(MODELS_DIR, { withFileTypes: true });
  } catch {
    console.error(`Folder "${MODELS_DIR}/" not found. Run this from the project root.`);
    process.exit(1);
  }

  const models = [];
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const files = await readdir(join(MODELS_DIR, d.name));
    const glb = files.find((f) => f.toLowerCase().endsWith('.glb'));
    if (!glb) { console.warn(`[skip] ${d.name}: no .glb file`); continue; }

    const mb = (await stat(join(MODELS_DIR, d.name, glb))).size / 1048576;
    if (mb >= GITHUB_LIMIT_MB) {
      console.warn(`[warn] ${d.name}/${glb} is ${mb.toFixed(0)} MB - GitHub rejects files over ${GITHUB_LIMIT_MB} MB. Compress it first.`);
    } else if (mb >= 50) {
      console.warn(`[warn] ${d.name}/${glb} is ${mb.toFixed(0)} MB - GitHub warns above 50 MB.`);
    }

    const prev = previous[d.name] || {};
    const rotation = (Array.isArray(prev.rotation) && prev.rotation.length === 3)
      ? prev.rotation
      : DEFAULT_ROTATION.slice();

    const entry = {
      id: d.name,
      name: prev.name || prettyName(d.name),
      // encode so spaces/special characters in file names still load
      url: `${MODELS_DIR}/${encodeURIComponent(d.name)}/${encodeURIComponent(glb)}`,
      rotation,
    };
    // Preserve tags if the entry already had them (including an explicit empty
    // array meaning "user said no tags"). Omit the field entirely for models
    // that have never been tagged - scaffold.ps1 prompts for those.
    if (Array.isArray(prev.tags)) entry.tags = prev.tags;

    models.push(entry);
  }

  models.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(
    OUT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), models }, null, 2) + '\n'
  );
  console.log(`Wrote ${OUT_FILE} with ${models.length} model(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });