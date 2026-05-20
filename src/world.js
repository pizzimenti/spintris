import * as THREE from 'three';
import { COLS, ROWS } from './tetris.js';
import {
  makeTileColorTexture,
  makeTileNormalTexture,
  makeTileRoughnessTexture,
  makeMarbleColorTexture,
  makeMarbleNormalFromColor,
  makeMarbleRoughnessFromColor,
} from './textures.js';

export const CELL = 0.55;
export const FIELD_W = COLS * CELL;
export const FIELD_H = ROWS * CELL;

const ARCH_INNER = 4.0;
const COL_HEIGHT = 11.0;
const COL_BASE_Y = -FIELD_H / 2 - 0.8;
const FLOOR_Y = COL_BASE_Y - 0.3;

export function buildScene({ anisotropy = 1 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04050b);
  scene.fog = new THREE.FogExp2(0x05060c, 0.026);

  // ---- Lighting ----------------------------------------------------------

  scene.add(new THREE.HemisphereLight(0xa6b8ff, 0x2a1f10, 0.35));

  const key = new THREE.DirectionalLight(0xfff0d0, 2.6);
  key.position.set(10, 16, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.camera.left = -16;
  key.shadow.camera.right = 16;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -12;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x6080ff, 0.75);
  fill.position.set(-12, 6, -8);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xff8866, 0.6);
  rim.position.set(0, 4, -14);
  scene.add(rim);

  const accent = new THREE.PointLight(0xffd699, 1.6, 16, 1.4);
  accent.position.set(0, 0, 4);
  scene.add(accent);

  // ---- Floor: tiled marble with grout, env-mapped reflections ------------

  const tileColor = makeTileColorTexture();
  const tileNormal = makeTileNormalTexture();
  const tileRough = makeTileRoughnessTexture();
  for (const t of [tileColor, tileNormal, tileRough]) {
    t.anisotropy = anisotropy;
    t.repeat.set(5, 5);
  }

  const floorMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: tileColor,
    normalMap: tileNormal,
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughnessMap: tileRough,
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.16,
    envMapIntensity: 1.0,
  });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  scene.add(floor);

  // ---- Rotating arch -----------------------------------------------------

  const archGroup = new THREE.Group();
  scene.add(archGroup);

  // Pink marble — high-detail color map, normal derived from color luminance,
  // varied roughness, and a touch of transmission/thickness so the stone
  // reads as semi-translucent (light bleeds at the silhouette edges).
  // 1024 is plenty — even with repeat(1, 3) on the column, each repeat
  // covers a small fraction of screen pixels. Halving from 2048 cuts the
  // Sobel-from-color normal pass to a quarter of the time (≈1M iterations
  // instead of 4M), so the page starts the animate loop fast enough that
  // no pieces stack while you're still loading.
  const marbleColor = makeMarbleColorTexture(1024);
  const marbleNormal = makeMarbleNormalFromColor(marbleColor, 1.3);
  const marbleRough = makeMarbleRoughnessFromColor(marbleColor);

  // Column tex set: 1× around the circumference, 3× along the height — keeps
  // the texel density roughly square given the cylinder's aspect ratio.
  const colTexColor = marbleColor.clone();   colTexColor.repeat.set(1, 3);
  const colTexNormal = marbleNormal.clone(); colTexNormal.repeat.set(1, 3);
  const colTexRough = marbleRough.clone();   colTexRough.repeat.set(1, 3);
  for (const t of [colTexColor, colTexNormal, colTexRough]) {
    t.anisotropy = anisotropy;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
  }
  if (colTexColor) colTexColor.colorSpace = THREE.SRGBColorSpace;

  // Arch tex set: tile along the arc (~4×) and once around the tube.
  const archTexColor = marbleColor.clone();   archTexColor.repeat.set(4, 1);
  const archTexNormal = marbleNormal.clone(); archTexNormal.repeat.set(4, 1);
  const archTexRough = marbleRough.clone();   archTexRough.repeat.set(4, 1);
  for (const t of [archTexColor, archTexNormal, archTexRough]) {
    t.anisotropy = anisotropy;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
  }
  if (archTexColor) archTexColor.colorSpace = THREE.SRGBColorSpace;

  const columnMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: colTexColor,
    normalMap: colTexNormal,
    // Reduced from 1.8 — high-frequency normal detail on a curved surface
    // combined with a tight clearcoat lobe causes sub-pixel specular flicker.
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughnessMap: colTexRough,
    roughness: 1.0,
    metalness: 0.0,
    // Broader clearcoat lobe so the highlight covers multiple pixels.
    clearcoat: 1.0,
    clearcoatRoughness: 0.16,
    // Light SSS-fake: subtle edge bleed without drowning the surface detail.
    transmission: 0.05,
    thickness: 0.35,
    ior: 1.5,
    attenuationColor: new THREE.Color(0xc88a82),
    attenuationDistance: 1.2,
    emissive: 0x3a1612,
    emissiveIntensity: 0.06,
    envMapIntensity: 0.7,
  });

  const archMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: archTexColor,
    normalMap: archTexNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: archTexRough,
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.18,
    transmission: 0.04,
    thickness: 0.3,
    ior: 1.5,
    attenuationColor: new THREE.Color(0xc88a82),
    attenuationDistance: 1.0,
    emissive: 0x3a1612,
    emissiveIntensity: 0.05,
    envMapIntensity: 0.7,
  });

  // Darker accent stone for capitals/bases — slightly rougher, less polished.
  const accentStoneMat = new THREE.MeshPhysicalMaterial({
    color: 0x6a5c45,
    roughness: 0.42,
    metalness: 0.05,
    clearcoat: 0.7,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.9,
  });

  // Glowing accent — small jewels, indicator stone.
  const jewelMat = new THREE.MeshPhysicalMaterial({
    color: 0xffcc66,
    emissive: 0xff7733,
    emissiveIntensity: 0.45,
    roughness: 0.3,
    metalness: 0.4,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
  });

  for (const side of [-1, 1]) {
    // Column shaft — higher segment count for smoother specular highlights.
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.65, COL_HEIGHT, 64, 1),
      columnMat
    );
    col.position.set(side * ARCH_INNER, COL_BASE_Y + COL_HEIGHT / 2, 0);
    col.castShadow = true;
    col.receiveShadow = true;
    archGroup.add(col);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.45, 1.55),
      accentStoneMat
    );
    cap.position.set(side * ARCH_INNER, COL_BASE_Y + COL_HEIGHT + 0.22, 0);
    cap.castShadow = true;
    cap.receiveShadow = true;
    archGroup.add(cap);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.4, 1.55),
      accentStoneMat
    );
    base.position.set(side * ARCH_INNER, COL_BASE_Y - 0.2, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    archGroup.add(base);
  }

  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(ARCH_INNER, 0.45, 32, 128, Math.PI),
    archMat
  );
  arch.position.set(0, COL_BASE_Y + COL_HEIGHT + 0.45, 0);
  arch.castShadow = true;
  arch.receiveShadow = true;
  archGroup.add(arch);

  const apexY = COL_BASE_Y + COL_HEIGHT + 0.45 + ARCH_INNER;
  const keystone = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.1, 1.4),
    accentStoneMat
  );
  keystone.position.set(0, apexY, 0);
  keystone.castShadow = true;
  keystone.receiveShadow = true;
  archGroup.add(keystone);

  const indicator = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.5, 4),
    jewelMat
  );
  indicator.position.set(0, COL_BASE_Y - 0.45, ARCH_INNER - 0.3);
  indicator.rotation.x = Math.PI;
  indicator.rotation.y = Math.PI / 4;
  archGroup.add(indicator);

  for (const side of [-1, 1]) {
    const j = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 32, 16),
      jewelMat
    );
    j.position.set(side * ARCH_INNER, COL_BASE_Y + COL_HEIGHT + 0.45, 0.78);
    archGroup.add(j);
  }

  // ---- Play-field wireframe ----------------------------------------------

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

const brickGeo = new THREE.BoxGeometry(CELL * 0.92, CELL * 0.92, CELL * 0.92);

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
    mat = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: mode === 'active' ? 0.5 : 0.28,
      roughness: 0.25,
      metalness: 0.25,
      clearcoat: 0.7,
      clearcoatRoughness: 0.12,
      envMapIntensity: 0.85,
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
