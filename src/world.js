import * as THREE from 'three';
import { COLS, ROWS } from './tetris.js';
import {
  makeConcreteColorTexture,
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

export function buildScene({ anisotropy = 1, shadowMapSize = 4096 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04050b);
  scene.fog = new THREE.FogExp2(0x05060c, 0.026);

  // ---- Lighting ----------------------------------------------------------

  scene.add(new THREE.HemisphereLight(0xa6b8ff, 0x2a1f10, 0.35));

  // Key light positioned directly behind the camera's starting orbit
  // position (camera begins at (0, 4, 17)), high enough that its shadow
  // ray drops perpendicular to the arch's plane (the arch lies in the
  // XY plane at z=0; shadow falls in -Z, straight away from us). As the
  // camera orbits the static arch, the shadow direction is fixed in
  // world space and the apparent angle changes with the viewpoint —
  // physically what would happen with a real-world fixed sun.
  const key = new THREE.DirectionalLight(0xfff0d0, 2.6);
  key.position.set(0, 20, 24);
  key.target.position.set(0, 0, 0);
  scene.add(key.target);
  key.castShadow = shadowMapSize > 0;
  key.shadow.mapSize.set(shadowMapSize || 1024, shadowMapSize || 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 70;
  key.shadow.camera.left = -16;
  key.shadow.camera.right = 16;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -14;
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

  // ---- Overhead light fixtures ------------------------------------------
  //
  // Two complementary mechanisms for the warehouse-ceiling-reflection
  // look from the reference photo:
  //
  //   (a) The custom warehouse env map (scene.environment) bakes bright
  //       horizontal bands at ceiling elevation — every PBR material
  //       gets these as IBL reflections regardless of camera angle.
  //
  //   (b) Visible emissive light fixtures positioned at y=7.5 in a row
  //       along the Z axis — low enough to fit inside the camera's FOV
  //       (camera at y=4 looking at y=-1.2 sees up to roughly y=7 at
  //       z=0), so SSR catches them and adds sharp streak reflections.
  //
  // Together you get always-on ambient ceiling reflection from (a) plus
  // the dramatic streak pattern from (b) when fixtures are in frame.
  const fixtureMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff0d6,
    emissiveIntensity: 4.5,
    roughness: 1.0,
    metalness: 0.0,
  });
  const fixtureGeo = new THREE.BoxGeometry(5.0, 0.12, 0.55);
  for (const z of [-22, -14, -6, 2]) {
    const fix = new THREE.Mesh(fixtureGeo, fixtureMat);
    fix.position.set(0, 7.5, z);
    scene.add(fix);
  }

  // ---- Floor: polished cured concrete with mirror clearcoat -------------

  // Poured concrete with fancy-garage epoxy clearcoat. ONE non-tiling
  // texture covers the whole floor — every crack, pit, stain, and saw-cut
  // is at a unique world position, so the eye never catches a repeat.
  const concreteColor = makeConcreteColorTexture(2048);
  const concreteNormal = makeMarbleNormalFromColor(concreteColor, 0.7);
  const concreteRough = makeMarbleRoughnessFromColor(concreteColor);
  for (const t of [concreteColor, concreteNormal, concreteRough]) {
    t.anisotropy = anisotropy;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(1, 1);
    t.needsUpdate = true;
  }

  const floorMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: concreteColor,
    normalMap: concreteNormal,
    // Bumps barely visible under the polish — real cured warehouse
    // concrete reads almost mirror-flat at the macro level. Detail
    // shows in the color map (aggregate) but not in geometry.
    normalScale: new THREE.Vector2(0.18, 0.18),
    roughnessMap: concreteRough,
    roughness: 1.0,
    // Low metalness — gives SSR a Fresnel bite without making the
    // floor read as polished steel.
    metalness: 0.04,
    // Mirror-sharp clearcoat lobe. The reference photo's defining
    // feature is razor-clean reflections of the ceiling lights —
    // clearcoatRoughness of 0.02 puts the highlight inside ~1px on
    // the screen at this camera distance.
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.0,
  });

  // Smaller floor plane (40×40) since the concrete texture doesn't tile —
  // beyond that, fog absorbs the edge. Avoids stretching the single 2048²
  // image across a huge plane and losing texel density.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat);
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
    // Transmission disabled: triggers a per-frame framebuffer-copy pass in
    // three.js for refraction, which is a Dawn slow path on this adapter.
    // Re-enable per-mesh if WebGPU perf improves on a future driver.
    // transmission: 0.05,
    // thickness: 0.35,
    // ior: 1.5,
    // attenuationColor: new THREE.Color(0xc88a82),
    // attenuationDistance: 1.2,
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
    // (transmission stripped — see columnMat note)
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

  // (Front-facing indicator cone removed — it was a compass for when the
  // arch itself spun; now the camera orbits the static arch, so there's
  // no orientation to indicate. The lingering bright bloom in front of
  // the arch base was this cone.)

  for (const side of [-1, 1]) {
    const j = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 32, 16),
      jewelMat
    );
    j.position.set(side * ARCH_INNER, COL_BASE_Y + COL_HEIGHT + 0.45, 0.78);
    archGroup.add(j);
  }

  // ---- Play-field grid (3D cylindrical bars) -----------------------------
  //
  // Each grid bar is a proper triangulated cylinder mesh, so:
  //   - no GL-line aliasing under TRAA
  //   - SSR / SSGI handle them like any other surface
  //   - they participate in PBR — future spider-web look just needs
  //     `transmission`, `thickness`, `iridescence` on this material
  //
  // GRID_R defines the bar radius (visible thickness). LANDING_R is the
  // beefier bottom indicator that shows hard-drop landing position.
  const GRID_R = 0.025;
  const LANDING_R = 0.05;

  const gridMat = new THREE.MeshPhysicalMaterial({
    color: 0xc8d6f0,
    transparent: true,
    opacity: 0.55,
    metalness: 0.1,
    roughness: 0.28,
    clearcoat: 0.7,
    clearcoatRoughness: 0.15,
    emissive: 0x1a2a48,
    emissiveIntensity: 0.18,
    envMapIntensity: 0.6,
    // Future spider-web hook: bump transmission to ~0.5, thickness ~0.04,
    // ior ~1.3, attenuationColor to cool white. Material left dielectric
    // and PBR-shaped so those are 1-line tweaks.
  });

  const landingMat = new THREE.MeshPhysicalMaterial({
    color: 0xffb060,
    emissive: 0xff7022,
    emissiveIntensity: 0.55,
    metalness: 0.2,
    roughness: 0.25,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 0.6,
  });

  function makeBar(start, end, radius, material) {
    const dir = new THREE.Vector3().subVectors(end, start);
    const length = dir.length();
    const geo = new THREE.CylinderGeometry(radius, radius, length, 10, 1, false);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(start).add(dir.clone().multiplyScalar(0.5));
    // Default cylinder axis is Y; rotate to point along dir.
    const up = new THREE.Vector3(0, 1, 0);
    mesh.quaternion.setFromUnitVectors(up, dir.normalize());
    // Grid bars are PBR geometry, so they cast and receive shadows like
    // any other mesh. With the shadow map at 2048/4096 the lattice
    // pattern reads cleanly on the floor.
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  const fieldGroup = new THREE.Group();
  // Vertical column dividers
  for (let c = 0; c <= COLS; c++) {
    const x = (c - COLS / 2) * CELL;
    fieldGroup.add(makeBar(
      new THREE.Vector3(x, -FIELD_H / 2, 0),
      new THREE.Vector3(x, FIELD_H / 2, 0),
      GRID_R, gridMat,
    ));
  }
  // Horizontal row dividers
  for (let r = 0; r <= ROWS; r++) {
    const y = FIELD_H / 2 - r * CELL;
    fieldGroup.add(makeBar(
      new THREE.Vector3(-FIELD_W / 2, y, 0),
      new THREE.Vector3(FIELD_W / 2, y, 0),
      GRID_R, gridMat,
    ));
  }
  // Landing line — thicker, brighter, signals hard-drop landing position
  fieldGroup.add(makeBar(
    new THREE.Vector3(-FIELD_W / 2 - 0.05, -FIELD_H / 2, 0),
    new THREE.Vector3(FIELD_W / 2 + 0.05, -FIELD_H / 2, 0),
    LANDING_R, landingMat,
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
