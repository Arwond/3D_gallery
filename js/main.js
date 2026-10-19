import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const viewport   = document.getElementById('viewport');
const select     = document.getElementById('model-select');
const overlay    = document.getElementById('overlay');
const overlayTxt = document.getElementById('overlay-text');
const info       = document.getElementById('info');
const btnReset   = document.getElementById('btn-reset');
const btnWire    = document.getElementById('btn-wireframe');
const btnGrid    = document.getElementById('btn-grid');
const btnFull    = document.getElementById('btn-fullscreen');
const btnRotX    = document.getElementById('btn-rot-x');
const btnRotY    = document.getElementById('btn-rot-y');
const btnRotZ    = document.getElementById('btn-rot-z');
const btnCopyRot = document.getElementById('btn-copy-rot');

const _deg2rad = Math.PI / 180;
const DEFAULT_ROTATION = [-90, 0, 120];   // used when a models.json entry has no "rotation"
const rotationOf = (entry) =>
  (entry && Array.isArray(entry.rotation) && entry.rotation.length === 3) ? entry.rotation : DEFAULT_ROTATION;

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
viewport.appendChild(renderer.domElement);

// ---------- Scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c1f24);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
camera.position.set(3, 2, 3);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;

// ---------- Lights ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.1));
const keyLight  = new THREE.DirectionalLight(0xffffff, 1.6); keyLight.position.set(5, 10, 7);  scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.5); fillLight.position.set(-6, 3, -5); scene.add(fillLight);
const rimLight  = new THREE.DirectionalLight(0xffffff, 0.3); rimLight.position.set(0, -5, -3); scene.add(rimLight);

// ---------- Grid ----------
const grid = new THREE.GridHelper(10, 20, 0x666666, 0x2e3138);
grid.material.transparent = true;
grid.material.opacity = 0.8;
scene.add(grid);

// ---------- Model root ----------
const modelRoot = new THREE.Group();
scene.add(modelRoot);
let currentMesh  = null;
let currentEntry = null;
let loadToken    = 0;      // guards against out-of-order loads
let wireframeOn  = false;

// ---------- Resize ----------
// The canvas is sized by CSS (100% x 100%); only the drawing buffer is set here.
function onResize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
if (window.ResizeObserver) new ResizeObserver(onResize).observe(viewport);
onResize();

// ---------- Render loop ----------
(function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); })();

// ---------- Overlay ----------
function showOverlay(t) { overlayTxt.textContent = t; overlay.hidden = false; }
function hideOverlay() { overlay.hidden = true; }

// ---------- Dispose ----------
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

// ---------- Framing ----------
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

// ---------- Loading (GLB) ----------
// Draco + Meshopt support, so compressed GLBs (gltf-transform / Zephyr) also work.
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
          const pct = Math.round((evt.loaded / evt.total) * 100);
          showOverlay('Loading ' + entry.name + '... ' + pct + '%');
        }
      },
      (err) => { console.error(err); if (token === loadToken) reject(err); else resolve(); }
    );
  });
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
  const safe = String(entry.name).replace(/[&<>"']/g, (c) => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
  info.innerHTML =
    '<div class="info-title">' + safe + '</div>' +
    '<div class="info-row">' + meshes + ' mesh' + (meshes === 1 ? '' : 'es') +
    ' | ' + Math.round(triangles).toLocaleString() + ' triangles</div>' +
    '<div class="info-row">Size ' + size.x.toFixed(2) + ' x ' +
    size.y.toFixed(2) + ' x ' + size.z.toFixed(2) + '</div>' +
    '<div class="info-row">Rotation ' + rot[0] + ', ' + rot[1] + ', ' + rot[2] + ' (deg)</div>';
  info.hidden = false;
}

// ---------- Toolbar ----------
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

// ---------- Init ----------
async function init() {
  try {
    const res = await fetch('models.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('models.json ' + res.status);
    const manifest = await res.json();
    const models = Array.isArray(manifest.models) ? manifest.models : [];
    if (!models.length) throw new Error('No models in models.json');

    select.innerHTML = '';
    for (const m of models) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.name || m.id;
      select.appendChild(o);
    }
    select.disabled = false;

    const open = async (entry) => {
      try { await loadModel(entry); }
      catch (err) {
        console.error(err);
        showOverlay('Failed to load "' + entry.name + '" (' + entry.url + '). ' +
          'Check the file exists and the name matches exactly, including upper/lower case.');
      }
    };

    select.addEventListener('change', () => {
      const entry = models.find((m) => m.id === select.value);
      if (entry) open(entry);
    });

    select.value = models[0].id;
    await open(models[0]);
  } catch (err) {
    console.error(err);
    showOverlay('Startup error: ' + (err.message || err));
  }
}

init();
