import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ============================================================
//  Settings
// ============================================================
const PAGE_SIZE = 25;                      // models per gallery page
const _deg2rad = Math.PI / 180;
const DEFAULT_ROTATION = [-90, 0, 120];    // used when a models.json entry has no "rotation"
const rotationOf = (entry) =>
  (entry && Array.isArray(entry.rotation) && entry.rotation.length === 3) ? entry.rotation : DEFAULT_ROTATION;

const hasTag = (entry, tag) => {
  if (!entry || !Array.isArray(entry.tags) || !tag) return false;
  const t = String(tag).toLowerCase();
  return entry.tags.some((x) => String(x).toLowerCase() === t);
};

// ============================================================
//  DOM
// ============================================================
const galleryView  = document.getElementById('gallery-view');
const galleryMain  = document.getElementById('gallery-main');
const galleryGrid  = document.getElementById('gallery-grid');
const galleryEmpty = document.getElementById('gallery-empty');
const galleryCount = document.getElementById('gallery-count');
const pagination   = document.getElementById('pagination');
const galleryFilter      = document.getElementById('gallery-filter');
const galleryFilterTag   = document.getElementById('gallery-filter-tag');
const galleryFilterClear = document.getElementById('gallery-filter-clear');

const viewerView = document.getElementById('viewer-view');
const viewport   = document.getElementById('viewport');
const modelTitle = document.getElementById('model-title');
const overlay    = document.getElementById('overlay');
const overlayTxt = document.getElementById('overlay-text');
const info       = document.getElementById('info');
const btnBack    = document.getElementById('btn-back');
const btnReset   = document.getElementById('btn-reset');
const btnWire    = document.getElementById('btn-wireframe');
const btnGrid    = document.getElementById('btn-grid');
const btnFull    = document.getElementById('btn-fullscreen');
const btnRotX    = document.getElementById('btn-rot-x');
const btnRotY    = document.getElementById('btn-rot-y');
const btnRotZ    = document.getElementById('btn-rot-z');
const btnCopyRot = document.getElementById('btn-copy-rot');

// ============================================================
//  3D viewer
// ============================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c1f24);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
camera.position.set(3, 2, 3);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;

// Lights (keep in sync with tools/thumb.js so thumbnails look like the viewer)
scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.1));
const keyLight  = new THREE.DirectionalLight(0xffffff, 1.6); keyLight.position.set(5, 10, 7);  scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.5); fillLight.position.set(-6, 3, -5); scene.add(fillLight);
const rimLight  = new THREE.DirectionalLight(0xffffff, 0.3); rimLight.position.set(0, -5, -3); scene.add(rimLight);

const grid = new THREE.GridHelper(10, 20, 0x666666, 0x2e3138);
grid.material.transparent = true;
grid.material.opacity = 0.8;
scene.add(grid);

const modelRoot = new THREE.Group();
scene.add(modelRoot);
let currentMesh  = null;
let currentEntry = null;
let loadToken    = 0;      // guards against out-of-order loads
let wireframeOn  = false;
let viewerActive = false;  // render loop only runs while the viewer is on screen

// The canvas is sized by CSS (100% x 100%); only the drawing buffer is set here.
function onResize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;                      // viewer hidden
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
if (window.ResizeObserver) new ResizeObserver(onResize).observe(viewport);

(function animate() {
  requestAnimationFrame(animate);
  if (!viewerActive) return;
  controls.update();
  renderer.render(scene, camera);
})();

function showOverlay(t) { overlayTxt.textContent = t; overlay.hidden = false; }
function hideOverlay() { overlay.hidden = true; }

function disposeMaterial(m) {
  if (!m) return;
  ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','specularMap','bumpMap','alphaMap','displacementMap','envMap']
    .forEach((k) => { if (m[k] && typeof m[k].dispose === 'function') m[k].dispose(); });
  m.dispose();
}
function disposeObject(o) {
  o.traverse((n) => {
    if (!n.isMesh) return;
    if (n.geometry) n.geometry.dispose();
    (Array.isArray(n.material) ? n.material : [n.material]).forEach(disposeMaterial);
  });
}
function clearModel() {
  if (!currentMesh) return;
  modelRoot.remove(currentMesh);
  disposeObject(currentMesh);
  currentMesh  = null;
  currentEntry = null;
  info.hidden = true;
}

function frameObject(o) {
  const box = new THREE.Box3().setFromObject(o);
  if (box.isEmpty()) return;
  const size   = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fovRad = (camera.fov * Math.PI) / 180;
  const dist   = ((maxDim / 2) / Math.tan(fovRad / 2)) * 1.6;
  camera.near = Math.max(maxDim / 1000, 0.001);
  camera.far  = maxDim * 1000;
  camera.position.set(center.x + dist * 0.6, center.y + dist * 0.45, center.z + dist * 0.85);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.minDistance = maxDim * 0.05;
  controls.maxDistance = maxDim * 30;
  controls.update();
  const gridTarget = Math.max(size.x, size.z) * 3 || 10;
  grid.scale.setScalar(gridTarget / 10);
}

function refitModel() {
  if (!currentMesh) return;
  currentMesh.position.set(0, 0, 0);
  currentMesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(currentMesh);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  currentMesh.position.x -= c.x;
  currentMesh.position.z -= c.z;
  currentMesh.position.y -= box.min.y;
  frameObject(currentMesh);
  if (currentEntry) updateInfo(currentEntry, currentMesh);
}

function rotateModel(axis, degrees) {
  if (!currentMesh) return;
  currentMesh.rotation[axis] += degrees * _deg2rad;
  refitModel();
}
function currentRotationDegrees() {
  if (!currentMesh) return [0, 0, 0];
  const d = (r) => Math.round(r / _deg2rad);
  return [d(currentMesh.rotation.x), d(currentMesh.rotation.y), d(currentMesh.rotation.z)];
}

// ---- GLB loading (Draco + Meshopt supported) ----
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

function applyWireframe(root) {
  root.traverse((n) => {
    if (!n.isMesh) return;
    (Array.isArray(n.material) ? n.material : [n.material])
      .forEach((m) => { if (m) m.wireframe = wireframeOn; });
  });
}

function loadModel(entry) {
  const token = ++loadToken;
  return new Promise((resolve, reject) => {
    clearModel();
    showOverlay('Loading ' + entry.name + '...');

    gltfLoader.load(
      entry.url,
      (gltf) => {
        const object = gltf.scene;
        if (token !== loadToken) { disposeObject(object); return resolve(); } // a newer load took over
        object.traverse((n) => {
          if (!n.isMesh) return;
          (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => {
            if (m) m.side = THREE.DoubleSide;
          });
        });
        const r0 = rotationOf(entry);
        object.rotation.set(r0[0] * _deg2rad, r0[1] * _deg2rad, r0[2] * _deg2rad);
        applyWireframe(object);
        modelRoot.add(object);
        currentMesh  = object;
        currentEntry = entry;
        refitModel();
        hideOverlay();
        resolve();
      },
      (evt) => {
        if (token !== loadToken) return;
        if (evt && evt.lengthComputable && evt.total) {
          const pct = Math.min(100, Math.round((evt.loaded / evt.total) * 100)); // capped: gzip makes loaded > total
          showOverlay('Loading ' + entry.name + '... ' + pct + '%');
        }
      },
      (err) => { console.error(err); if (token === loadToken) reject(err); else resolve(); }
    );
  });
}

async function openModel(entry) {
  try { await loadModel(entry); }
  catch (err) {
    console.error(err);
    showOverlay('Failed to load "' + entry.name + '" (' + entry.url + '). ' +
      'Check the file exists and the name matches exactly, including upper/lower case.');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

function updateInfo(entry, object) {
  let triangles = 0, meshes = 0;
  object.traverse((n) => {
    if (!n.isMesh || !n.geometry) return;
    meshes++;
    const g = n.geometry;
    if (g.index && g.index.count)   triangles += g.index.count / 3;
    else if (g.attributes.position) triangles += g.attributes.position.count / 3;
  });
  const box  = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const rot  = currentRotationDegrees();

  const tagsHtml = (entry.tags && entry.tags.length)
    ? '<div class="info-row info-tags">' +
      entry.tags.map((t) =>
        '<a class="tag-chip" href="' + galleryHash(t, 1) + '">#' + escapeHtml(t) + '</a>'
      ).join('') +
      '</div>'
    : '';

  info.innerHTML =
    '<div class="info-title">' + escapeHtml(entry.name) + '</div>' +
    '<div class="info-row">' + meshes + ' mesh' + (meshes === 1 ? '' : 'es') +
    ' | ' + Math.round(triangles).toLocaleString() + ' triangles</div>' +
    '<div class="info-row">Size ' + size.x.toFixed(2) + ' x ' +
    size.y.toFixed(2) + ' x ' + size.z.toFixed(2) + '</div>' +
    '<div class="info-row">Rotation ' + rot[0] + ', ' + rot[1] + ', ' + rot[2] + ' (deg)</div>' +
    tagsHtml;
  info.hidden = false;
}

// ---- Viewer toolbar ----
btnReset.addEventListener('click', () => {
  if (!currentMesh || !currentEntry) return;
  const r = rotationOf(currentEntry);
  currentMesh.rotation.set(r[0] * _deg2rad, r[1] * _deg2rad, r[2] * _deg2rad);
  refitModel();
});
btnRotX.addEventListener('click', () => rotateModel('x', 90));
btnRotY.addEventListener('click', () => rotateModel('y', 90));
btnRotZ.addEventListener('click', () => rotateModel('z', 90));

let overlayTimer = null;
btnCopyRot.addEventListener('click', async () => {
  if (!currentMesh) return;
  const txt = JSON.stringify(currentRotationDegrees());
  console.log('Rotation for models.json:', txt);
  let msg;
  try {
    await navigator.clipboard.writeText(txt);
    msg = 'Copied ' + txt + '  (paste into models.json as "rotation")';
  } catch {
    msg = 'Rotation is ' + txt + '  (also in the console)';
  }
  showOverlay(msg);
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(hideOverlay, 2500);
});

btnWire.addEventListener('click', () => {
  wireframeOn = !wireframeOn;
  btnWire.setAttribute('aria-pressed', String(wireframeOn));
  applyWireframe(modelRoot);
});

btnGrid.addEventListener('click', () => {
  grid.visible = !grid.visible;
  btnGrid.setAttribute('aria-pressed', String(grid.visible));
});

// iPhone Safari has no Fullscreen API for pages - hide the button there.
if (!document.fullscreenEnabled) {
  btnFull.hidden = true;
} else {
  btnFull.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) { console.warn(e); }
  });
  document.addEventListener('fullscreenchange', () => {
    btnFull.setAttribute('aria-pressed', String(!!document.fullscreenElement));
    setTimeout(onResize, 60);
  });
}

// ============================================================
//  Gallery
// ============================================================
let models        = [];       // all models from models.json
let manifestStamp = '';
let activeTag     = null;     // null = unfiltered; otherwise filter by this tag
let currentList   = [];       // models currently visible (== models, or filtered by activeTag)
let renderedPage  = 0;        // gallery page currently built in the DOM (0 = none)
let renderedTag   = null;     // activeTag for the currently built DOM

const totalPages = () => Math.max(1, Math.ceil(currentList.length / PAGE_SIZE));
const pageHash   = (p) => '#/page/' + p;
const tagHash    = (tag, p) => '#/tag/' + encodeURIComponent(tag) + '/page/' + p;
const galleryHash = (tag, page) => tag ? tagHash(tag, page) : pageHash(page);
const modelHash  = (id) => '#/model/' + encodeURIComponent(id);
const pageOfModel = (id) => {
  const i = models.findIndex((m) => m.id === id);
  return i < 0 ? 1 : Math.floor(i / PAGE_SIZE) + 1;
};

// models/<id>/thumb.jpg sits next to the .glb (made by scaffold.ps1)
function thumbUrl(entry) {
  const base = entry.thumb || String(entry.url).replace(/[^/]*$/, 'thumb.jpg');
  return base + (manifestStamp ? '?v=' + encodeURIComponent(manifestStamp) : '');
}

function makeCard(entry) {
  const card = document.createElement('div');
  card.className = 'card';

  const link = document.createElement('a');
  link.className = 'card-main';
  link.href = modelHash(entry.id);
  link.title = entry.name;

  const box = document.createElement('div');
  box.className = 'thumb';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = entry.name;
  img.addEventListener('error', () => { img.remove(); box.classList.add('no-thumb'); });
  img.src = thumbUrl(entry);
  box.appendChild(img);
  link.appendChild(box);

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = entry.name;
  link.appendChild(title);

  card.appendChild(link);

  if (Array.isArray(entry.tags) && entry.tags.length) {
    const tagsRow = document.createElement('div');
    tagsRow.className = 'card-tags';
    entry.tags.forEach((tag) => {
      const a = document.createElement('a');
      a.className = 'tag-chip';
      a.href = galleryHash(tag, 1);
      a.textContent = '#' + tag;
      tagsRow.appendChild(a);
    });
    card.appendChild(tagsRow);
  }

  return card;
}

// 1 ... 4 5 [6] 7 8 ... 20
function pageList(cur, total) {
  const keep = new Set([1, total, cur - 1, cur, cur + 1]);
  if (cur <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (cur >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => keep.add(n));
  const nums = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) out.push('gap');
    out.push(n);
    prev = n;
  }
  return out;
}

function renderPagination(cur, total) {
  pagination.innerHTML = '';
  if (total <= 1) { pagination.hidden = true; return; }
  pagination.hidden = false;

  const link = (label, page, extra) => {
    const a = document.createElement('a');
    a.href = galleryHash(activeTag, page);
    a.textContent = label;
    if (extra) extra(a);
    pagination.appendChild(a);
  };
  const dead = (label) => {
    const s = document.createElement('span');
    s.textContent = label;
    s.setAttribute('aria-disabled', 'true');
    pagination.appendChild(s);
  };

  if (cur > 1) link('\u2039 Prev', cur - 1); else dead('\u2039 Prev');
  for (const item of pageList(cur, total)) {
    if (item === 'gap') {
      const s = document.createElement('span');
      s.className = 'gap';
      s.textContent = '\u2026';
      pagination.appendChild(s);
    } else {
      link(String(item), item, (a) => {
        if (item === cur) a.setAttribute('aria-current', 'page');
        a.setAttribute('aria-label', 'Page ' + item);
      });
    }
  }
  if (cur < total) link('Next \u203a', cur + 1); else dead('Next \u203a');
}

function renderGallery(page) {
  galleryGrid.innerHTML = '';
  const start = (page - 1) * PAGE_SIZE;
  const slice = currentList.slice(start, start + PAGE_SIZE);
  const frag = document.createDocumentFragment();
  slice.forEach((m) => frag.appendChild(makeCard(m)));
  galleryGrid.appendChild(frag);
  renderPagination(page, totalPages());
  renderedPage = page;
  renderedTag  = activeTag;
  galleryCount.textContent = currentList.length + ' model' + (currentList.length === 1 ? '' : 's') +
    (totalPages() > 1 ? ' | page ' + page + ' of ' + totalPages() : '');
}

function showGalleryMessage(text) {
  galleryGrid.innerHTML = '';
  pagination.hidden = true;
  galleryCount.textContent = '';
  galleryEmpty.textContent = text;
  galleryEmpty.hidden = false;
  renderedPage = 0;
  renderedTag  = activeTag;
}

// ============================================================
//  Router  (URL hash + browser history)
//    #/page/3                  gallery, page 3 (all models)
//    #/tag/sculpture/page/2    gallery filtered by tag #sculpture, page 2
//    #/model/<id>              one model
//  Because the page number and the active tag live in the URL, the browser
//  Back button (or mouse back button) from a model returns to the exact
//  gallery page and scroll position the model was opened from.
// ============================================================
let lastKey = null;

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (parts[0] === 'model' && parts[1]) {
      return { view: 'model', id: decodeURIComponent(parts.slice(1).join('/')) };
    }
  } catch { /* malformed id -> fall through to gallery */ }

  let tag = null;
  let page = 1;
  let i = 0;
  if (parts[i] === 'tag' && parts[i + 1]) {
    try { tag = decodeURIComponent(parts[i + 1]); } catch { tag = parts[i + 1]; }
    i += 2;
  }
  if (parts[i] === 'page') {
    const n = parseInt(parts[i + 1], 10);
    page = n > 0 ? n : 1;
  }
  return { view: 'gallery', tag, page };
}

function rememberScroll() {
  if (galleryView.hidden) return;
  history.replaceState(Object.assign({}, history.state, { app: true, scroll: galleryMain.scrollTop }), '');
}

function navigate(hash) {
  if (location.hash === hash) return;
  rememberScroll();
  history.pushState({ app: true }, '', hash);
  route();
}

function stopViewer() {
  viewerActive = false;
  loadToken++;               // cancel any model still loading
  clearModel();
  hideOverlay();
}

function showGallery(tag, page, scroll) {
  stopViewer();
  viewerView.hidden = true;
  galleryView.hidden = false;

  activeTag = tag || null;
  currentList = activeTag ? models.filter((m) => hasTag(m, activeTag)) : models;

  const total = totalPages();
  const p = Math.min(Math.max(1, page), total);
  if (p !== page) {                                  // out-of-range page in the URL
    history.replaceState(history.state, '', galleryHash(activeTag, p));
    lastKey = location.hash;
  }

  // filter banner
  if (activeTag) {
    galleryFilter.hidden = false;
    galleryFilterTag.textContent = '#' + activeTag;
    galleryFilterClear.href = pageHash(1);
  } else {
    galleryFilter.hidden = true;
  }

  if (currentList.length) {
    galleryEmpty.hidden = true;
    if (p !== renderedPage || activeTag !== renderedTag) renderGallery(p);
  } else {
    showGalleryMessage(
      activeTag
        ? 'No models tagged #' + activeTag + '.'
        : 'No models yet. Add .glb files and run scaffold.ps1.'
    );
  }

  galleryMain.scrollTop = scroll || 0;
  document.title = '3D Model Gallery' +
    (activeTag ? ' - #' + activeTag : '') +
    (total > 1 ? ' - page ' + p : '');
}

function showViewer(entry) {
  galleryView.hidden = true;
  viewerView.hidden = false;
  viewerActive = true;
  modelTitle.textContent = entry.name;
  document.title = entry.name + ' - 3D Model Gallery';
  onResize();
  if (currentMesh && currentEntry && currentEntry.id === entry.id) return;
  openModel(entry);
}

function route() {
  const key = location.hash;
  if (key === lastKey) return;                       // popstate + hashchange both fire
  lastKey = key;

  const r = parseHash();
  if (r.view === 'model') {
    const entry = models.find((m) => m.id === r.id);
    if (entry) { showViewer(entry); return; }
    history.replaceState(null, '', pageHash(1));     // unknown model id
    lastKey = location.hash;
    showGallery(null, 1, 0);
    return;
  }
  const st = history.state;
  showGallery(r.tag, r.page, st && st.scroll);
}

window.addEventListener('popstate', route);
window.addEventListener('hashchange', route);

// plain clicks are handled in-app; ctrl/middle click still open a new tab
function onLinkClick(e) {
  const a = e.target.closest('a[href^="#/"]');
  if (!a) return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
}
galleryMain.addEventListener('click', onLinkClick);   // cards, tag chips, pagination, filter-clear
info.addEventListener('click', onLinkClick);          // tag chips in the viewer info panel

// "Gallery" button in the viewer: behave exactly like the browser Back button
btnBack.addEventListener('click', () => {
  if (history.state && history.state.app) { history.back(); return; }
  const id = currentEntry ? currentEntry.id : parseHash().id;   // opened by direct link
  navigate(pageHash(pageOfModel(id)));
});

// ============================================================
//  Init
// ============================================================
async function init() {
  try {
    const res = await fetch('models.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('models.json ' + res.status);
    const manifest = await res.json();
    models = Array.isArray(manifest.models) ? manifest.models : [];
    manifestStamp = manifest.generatedAt || '';
    if (!models.length) {
      showGalleryMessage('No models yet. Add .glb files and run scaffold.ps1.');
    }
  } catch (err) {
    console.error(err);
    showGalleryMessage('Could not load models.json: ' + (err.message || err));
  }
  route();
}

init();