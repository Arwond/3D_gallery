// tools/thumb.js - render one GLB and POST a JPEG back to make-thumbnails.mjs
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const D2R = Math.PI / 180;
const W = 640;
const H = 480;

const q = new URLSearchParams(location.search);
const SAVE_PATH = q.get('save') || '';
const MODEL_URL = '/' + String(q.get('model') || '').replace(/^\/+/, '');
const ROT = (q.get('rot') || '-90,0,120').split(',').map((n) => Number(n) || 0);

function notify(kind, body) {
  return fetch('/__' + kind + '?path=' + encodeURIComponent(SAVE_PATH), {
    method: 'POST',
    body: body == null ? kind : body,
  }).catch(() => {});
}

async function render() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1c1f24);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.1));
  const key  = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(5, 10, 7);   scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-6, 3, -5); scene.add(fill);
  const rim  = new THREE.DirectionalLight(0xffffff, 0.3); rim.position.set(0, -5, -3);  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 10000);

  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);

  const gltf = await loader.loadAsync(MODEL_URL);
  const object = gltf.scene;

  object.traverse((n) => {
    if (!n.isMesh) return;
    (Array.isArray(n.material) ? n.material : [n.material])
      .forEach((m) => { if (m) m.side = THREE.DoubleSide; });
  });

  object.rotation.set(ROT[0] * D2R, ROT[1] * D2R, ROT[2] * D2R);
  scene.add(object);
  object.updateMatrixWorld(true);

  let box = new THREE.Box3().setFromObject(object);
  const c = box.getCenter(new THREE.Vector3());
  object.position.x -= c.x;
  object.position.z -= c.z;
  object.position.y -= box.min.y;
  object.updateMatrixWorld(true);

  box = new THREE.Box3().setFromObject(object);
  const size   = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fovRad = (camera.fov * Math.PI) / 180;
  const dist   = ((maxDim / 2) / Math.tan(fovRad / 2)) * 1.6;

  camera.near = Math.max(maxDim / 1000, 0.001);
  camera.far  = maxDim * 1000;
  camera.position.set(center.x + dist * 0.6, center.y + dist * 0.45, center.z + dist * 0.85);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  await new Promise((r) => requestAnimationFrame(r));
  renderer.render(scene, camera);

  const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.86);
  await notify('save', dataUrl);
}

render().catch((err) => notify('fail', String((err && err.message) || err)));