import * as THREE from 'three';
import { COLS, ROWS } from './tetris.js';

export const CELL = 0.55;
export const FIELD_W = COLS * CELL;
export const FIELD_H = ROWS * CELL;

const ARCH_INNER = 4.0;
const COL_HEIGHT = 11.0;
const COL_BASE_Y = -FIELD_H / 2 - 0.8;

export function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04050b);
  scene.fog = new THREE.FogExp2(0x05060c, 0.028);

  // Hemisphere for ambient sky/ground contrast
  scene.add(new THREE.HemisphereLight(0xa6b8ff, 0x2a1f10, 0.45));

  // Warm key light
  const key = new THREE.DirectionalLight(0xfff0d0, 2.4);
  key.position.set(10, 16, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.camera.left = -16;
  key.shadow.camera.right = 16;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -12;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  // Cool fill from opposite
  const fill = new THREE.DirectionalLight(0x6080ff, 0.7);
  fill.position.set(-12, 6, -8);
  scene.add(fill);

  // Rim from behind, slightly warm
  const rim = new THREE.DirectionalLight(0xff8866, 0.55);
  rim.position.set(0, 4, -14);
  scene.add(rim);

  // Floating accent inside the arch — picks up the bricks
  const accent = new THREE.PointLight(0xffd699, 1.6, 16, 1.4);
  accent.position.set(0, 0, 4);
  scene.add(accent);

  // Ground disc
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(50, 96),
    new THREE.MeshStandardMaterial({
      color: 0x141420,
      roughness: 0.6,
      metalness: 0.2,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = COL_BASE_Y - 0.3;
  ground.receiveShadow = true;
  scene.add(ground);

  // Rotating arch container
  const archGroup = new THREE.Group();
  scene.add(archGroup);

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xc8b693,
    roughness: 0.78,
    metalness: 0.06,
  });
  const darkStoneMat = new THREE.MeshStandardMaterial({
    color: 0x8a7858,
    roughness: 0.85,
    metalness: 0.05,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xffcc66,
    emissive: 0xff7733,
    emissiveIntensity: 1.0,
    roughness: 0.45,
    metalness: 0.2,
  });

  for (const side of [-1, 1]) {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.65, COL_HEIGHT, 32, 1),
      stoneMat
    );
    col.position.set(side * ARCH_INNER, COL_BASE_Y + COL_HEIGHT / 2, 0);
    col.castShadow = true;
    col.receiveShadow = true;
    archGroup.add(col);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.45, 1.55),
      darkStoneMat
    );
    cap.position.set(side * ARCH_INNER, COL_BASE_Y + COL_HEIGHT + 0.22, 0);
    cap.castShadow = true;
    archGroup.add(cap);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.4, 1.55),
      darkStoneMat
    );
    base.position.set(side * ARCH_INNER, COL_BASE_Y - 0.2, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    archGroup.add(base);
  }

  // Arch curve (half-torus)
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(ARCH_INNER, 0.45, 24, 96, Math.PI),
    stoneMat
  );
  arch.position.set(0, COL_BASE_Y + COL_HEIGHT + 0.45, 0);
  arch.castShadow = true;
  archGroup.add(arch);

  // Keystone at apex
  const apexY = COL_BASE_Y + COL_HEIGHT + 0.45 + ARCH_INNER;
  const keystone = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.1, 1.4),
    darkStoneMat
  );
  keystone.position.set(0, apexY, 0);
  keystone.castShadow = true;
  archGroup.add(keystone);

  // Glowing indicator stone at front base (so you can find "front")
  const indicator = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.5, 4),
    accentMat
  );
  indicator.position.set(0, COL_BASE_Y - 0.45, ARCH_INNER - 0.3);
  indicator.rotation.x = Math.PI;
  indicator.rotation.y = Math.PI / 4;
  archGroup.add(indicator);

  // Capital accent jewels
  for (const side of [-1, 1]) {
    const j = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 24, 12),
      accentMat
    );
    j.position.set(side * ARCH_INNER, COL_BASE_Y + COL_HEIGHT + 0.45, 0.78);
    archGroup.add(j);
  }

  // Play-field wireframe — sits inside arch group, rotates with it
  const gridMat = new THREE.LineBasicMaterial({
    color: 0x4a5a72,
    transparent: true,
    opacity: 0.32,
  });
  const fieldGroup = new THREE.Group();
  for (let c = 0; c <= COLS; c++) {
    const x = (c - COLS / 2) * CELL;
    fieldGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, -FIELD_H / 2, 0),
        new THREE.Vector3(x, FIELD_H / 2, 0),
      ]),
      gridMat
    ));
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = FIELD_H / 2 - r * CELL;
    fieldGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-FIELD_W / 2, y, 0),
        new THREE.Vector3(FIELD_W / 2, y, 0),
      ]),
      gridMat
    ));
  }
  // Bright floor line for the well
  fieldGroup.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-FIELD_W / 2, -FIELD_H / 2, 0),
      new THREE.Vector3(FIELD_W / 2, -FIELD_H / 2, 0),
    ]),
    new THREE.LineBasicMaterial({ color: 0xffa84a })
  ));
  archGroup.add(fieldGroup);

  const piecesGroup = new THREE.Group();
  archGroup.add(piecesGroup);

  return { scene, archGroup, piecesGroup };
}

export function cellPosition(col, row) {
  return new THREE.Vector3(
    (col - (COLS - 1) / 2) * CELL,
    ((ROWS - 1) / 2 - row) * CELL,
    0
  );
}

// Shared geometry — all bricks are the same shape
const brickGeo = new THREE.BoxGeometry(CELL * 0.92, CELL * 0.92, CELL * 0.92);

// Cache materials by (color, mode). Sharing is fine — the active-piece pulse
// modifies emissiveIntensity on the shared 'active' material so all four
// cells of the active tetromino pulse in unison, which is what we want.
const matCache = new Map();
function getBrickMaterial(color, mode) {
  const key = `${color}-${mode}`;
  let mat = matCache.get(key);
  if (mat) return mat;
  if (mode === 'ghost') {
    mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.14, depthWrite: false,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: mode === 'active' ? 0.55 : 0.22,
      roughness: 0.28,
      metalness: 0.35,
    });
  }
  matCache.set(key, mat);
  return mat;
}

export function createBrick(color, mode = 'settled') {
  const mesh = new THREE.Mesh(brickGeo, getBrickMaterial(color, mode));
  if (mode !== 'ghost') {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return mesh;
}
