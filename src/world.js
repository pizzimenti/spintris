import * as THREE from 'three';
import { COLS, ROWS } from './tetris.js';
import {
  makeConcreteColorTexture,
  makeDisplacementFromColor,
  makeMarbleColorTexture,
  makeMarbleNormalFromColor,
  makeMarbleRoughnessFromColor,
  makeSaltColorTexture,
  makeSaltDisplacementTexture,
  makeOpacityVeinMapFromColor,
} from './textures.js';

export const CELL = 0.55;
export const FIELD_W = COLS * CELL;
export const FIELD_H = ROWS * CELL;

const ARCH_INNER = 4.0;
const COL_HEIGHT = 11.0;
const COL_BASE_Y = -FIELD_H / 2 - 0.8;
const FLOOR_Y = COL_BASE_Y - 0.3;

export function buildScene({
  anisotropy = 1,
  shadowMapSize = 4096,
  columnMaterial = 'marble',
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04050b);
  scene.fog = new THREE.FogExp2(0x05060c, 0.026);

  // ---- Lighting ----------------------------------------------------------
  //
  // Lights that should dim together when entering salt-lamp mode are
  // pushed onto `dimableLights`. The corner lamp shade materials are
  // tracked separately so their emissive globes fade in lockstep with
  // the point lights they emit (visually the same fixture).
  const dimableLights = [];
  const lampShadeMaterials = [];

  const hemi = new THREE.HemisphereLight(0xa6b8ff, 0x2a1f10, 0.35);
  scene.add(hemi);
  dimableLights.push(hemi);

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
  dimableLights.push(key);

  const fill = new THREE.DirectionalLight(0x6080ff, 0.75);
  fill.position.set(-12, 6, -8);
  scene.add(fill);
  dimableLights.push(fill);

  const rim = new THREE.DirectionalLight(0xff8866, 0.6);
  rim.position.set(0, 4, -14);
  scene.add(rim);
  dimableLights.push(rim);

  const accent = new THREE.PointLight(0xffd699, 1.6, 16, 1.4);
  accent.position.set(0, 0, 4);
  scene.add(accent);
  dimableLights.push(accent);

  // ---- Corner stand lamps -----------------------------------------------
  //
  // Four floor lamps at the corners surrounding the arch, half the arch's
  // total height. Thin dark metal pole, glowing globe shade at the top
  // with a co-located warm point light. These are the only ambient light
  // sources besides the key spotlight that throws the arch's shadow.
  const archTotalHeight = COL_HEIGHT + 0.45 + ARCH_INNER + 0.6; // base→keystone top
  const LAMP_H = archTotalHeight / 2;          // half arch height
  const LAMP_OFFSET = 6.5;                      // distance from origin in X/Z
  const lampPositions = [
    [+LAMP_OFFSET, +LAMP_OFFSET],
    [-LAMP_OFFSET, +LAMP_OFFSET],
    [+LAMP_OFFSET, -LAMP_OFFSET],
    [-LAMP_OFFSET, -LAMP_OFFSET],
  ];

  const poleGeo = new THREE.CylinderGeometry(0.04, 0.06, LAMP_H, 14, 1);
  const poleMat = new THREE.MeshPhysicalMaterial({
    color: 0x18181c,
    roughness: 0.35,
    metalness: 0.85,
    clearcoat: 0.4,
    clearcoatRoughness: 0.2,
  });
  const baseGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.08, 24, 1);
  const shadeGeo = new THREE.SphereGeometry(0.34, 28, 18);
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xfff2d4,
    emissive: 0xffd095,
    emissiveIntensity: 3.2,
    roughness: 0.45,
    metalness: 0.05,
  });

  // Each lamp gets its OWN shade material instance so each one's
  // emissiveIntensity can be dimmed independently (well — together by
  // LightTransition.apply(); but they need separate refs since the
  // class scales each captured material individually).
  for (const [px, pz] of lampPositions) {
    const baseY = FLOOR_Y + 0.04;
    const base = new THREE.Mesh(baseGeo, poleMat);
    base.position.set(px, baseY, pz);
    base.castShadow = true;
    base.receiveShadow = true;
    scene.add(base);

    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(px, baseY + LAMP_H / 2, pz);
    pole.castShadow = true;
    scene.add(pole);

    const myShadeMat = shadeMat.clone();
    const shade = new THREE.Mesh(shadeGeo, myShadeMat);
    shade.position.set(px, baseY + LAMP_H + 0.05, pz);
    scene.add(shade);
    lampShadeMaterials.push(myShadeMat);

    // Warm point light co-located with the shade. No castShadow on these
    // — adding cube-map shadow casts for 4 point lights would multiply
    // shadow render cost by ~24 passes per frame for marginal gain.
    const light = new THREE.PointLight(0xffd095, 7.5, 16, 1.5);
    light.position.set(px, baseY + LAMP_H + 0.05, pz);
    scene.add(light);
    dimableLights.push(light);
  }

  // ---- Floor: polished cured concrete with mirror clearcoat -------------

  // Poured concrete with crackle/pitting/missing chunks + actual vertex
  // displacement for the deeper marring. ONE non-tiling texture covers
  // the floor; every defect is at a unique world position. Heightmap is
  // luminance-derived so the dark pits/chunks/cracks in the color map
  // physically recess into the geometry on the subdivided floor mesh.
  const concreteColor = makeConcreteColorTexture(2048);
  // Concrete is ClampToEdge-wrapped (non-tiling), so pass seamless=false
  // to the normal sampler — otherwise border pixels read across to the
  // far edge and produce visible normal artifacts at the texture borders.
  const concreteNormal = makeMarbleNormalFromColor(concreteColor, 1.4, false);
  const concreteRough = makeMarbleRoughnessFromColor(concreteColor);
  const concreteDisp = makeDisplacementFromColor(concreteColor, 1.8);
  for (const t of [concreteColor, concreteNormal, concreteRough, concreteDisp]) {
    t.anisotropy = anisotropy;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(1, 1);
    t.needsUpdate = true;
  }

  const floorMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: concreteColor,
    normalMap: concreteNormal,
    // Bumps amped up now that we have actual geometry displacement —
    // the normal map handles the high-frequency pit shading while the
    // displacement map handles the chunk-missing depth.
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: concreteRough,
    roughness: 1.0,
    metalness: 0.04,
    // Vertex displacement — recessed pits/cracks/chunks-missing in the
    // dark areas of the heightmap. Bias = -scale puts the bright matrix
    // at zero displacement (surface level) and the darkest defects at
    // -scale (deepest). 0.06 unit = ~10% of a Tetris cell, visible
    // at close range without breaking the silhouette.
    displacementMap: concreteDisp,
    displacementScale: 0.06,
    displacementBias: -0.06,
    // Clearcoat still on (polished sealed look) but rougher than the
    // pristine reference — the marring under the clearcoat scatters
    // the highlight a bit, so a clean 0.02 lobe would look fake.
    clearcoat: 0.85,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.0,
  });

  // Subdivided floor — 192×192 segments (74k tris) so displacementMap has
  // vertices to push around for the missing-chunk depth. Lower than this
  // and the pits stay flat-looking; higher costs more than it adds since
  // the high-frequency pit detail is captured in the normal map anyway.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 192, 192), floorMat);
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

  // ---- Column / arch material (slider-selected) ------------------------
  //
  // Three modes for the columns + half-torus arch:
  //
  //   marble — current PBR pink marble (color/normal/roughness from the
  //            generated texture set), no transmission so the WebGPU
  //            framebuffer-copy slow path stays inactive.
  //   salt   — rough Himalayan-pink-salt. High transmission + thickness
  //            with warm attenuation color so light bleeds through and
  //            takes on an orange tint inside; emissive simulates the
  //            interior glow of a salt lamp. Rougher surface (no clearcoat
  //            polish) so it reads as cut crystal, not polished stone.
  //   glass  — clear crystal. Near-full transmission, very low roughness,
  //            sharp clearcoat, neutral attenuation, ior 1.5.
  //
  // SALT and GLASS both turn transmission on, which triggers a per-frame
  // framebuffer-copy pass for refraction. On Dawn / RADV this can be a
  // slow path; the engine HUD's FPS readout will surface any regression.

  // Build all three material variants up front so we can hot-swap between
  // them without reloading the page. Textures are referenced not copied,
  // so this is cheap memory-wise.
  const marbleColumnMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: colTexColor,
    normalMap: colTexNormal,
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughnessMap: colTexRough,
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.16,
    emissive: 0x3a1612,
    emissiveIntensity: 0.06,
    envMapIntensity: 0.7,
  });
  const marbleArchMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: archTexColor,
    normalMap: archTexNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: archTexRough,
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.18,
    emissive: 0x3a1612,
    emissiveIntensity: 0.05,
    envMapIntensity: 0.7,
  });

  // Salt — Himalayan salt lamp. Pink-amber-crimson color range with bright
  // milky-white opaque veins, crusty (chunky) surface via displacement,
  // strong inner glow that's BLOCKED by the white veins (via emissiveMap
  // and transmissionMap both fed from the same vein-opacity mask).
  const saltColor = makeSaltColorTexture(2048);
  const saltNormal = makeMarbleNormalFromColor(saltColor, 1.5);
  const saltRough = makeMarbleRoughnessFromColor(saltColor);
  const saltDisp = makeSaltDisplacementTexture(1024);
  const saltVeinMask = makeOpacityVeinMapFromColor(saltColor, 2.2);
  for (const t of [saltColor, saltNormal, saltRough, saltDisp, saltVeinMask]) {
    t.anisotropy = anisotropy;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
  }

  const saltOpts = {
    color: 0xff8a78,
    map: saltColor,
    normalMap: saltNormal,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughnessMap: saltRough,
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: 0.0,
    // Translucent salt — light passes through everywhere EXCEPT the
    // white veins, which are masked to 0 transmission (and 0 emissive).
    transmission: 0.88,
    transmissionMap: saltVeinMask,
    thickness: 1.6,
    ior: 1.55,
    attenuationColor: new THREE.Color(0xff5a40),
    attenuationDistance: 1.4,
    emissive: 0xff5c34,
    emissiveIntensity: 1.05,
    emissiveMap: saltVeinMask,
    // Crusty bumpy surface — chunks of geometry protruding (white in disp
    // map) interleaved with pits (dark). Mid-gray = no displacement under
    // bias=-scale/2.
    displacementMap: saltDisp,
    displacementScale: 0.18,
    displacementBias: -0.09,
    envMapIntensity: 0.4,
  };
  const saltColumnMat = new THREE.MeshPhysicalMaterial(saltOpts);
  // Arch shares the same material — the displacement reads consistently
  // even with the torus UV layout because the salt map repeats.
  const saltArchMat = new THREE.MeshPhysicalMaterial({
    ...saltOpts,
    // Smaller chunks on the curved arch so the silhouette stays readable.
    displacementScale: 0.10,
    displacementBias: -0.05,
  });

  // Glass — no texture maps (would read as dirt smeared on clean crystal).
  const glassOpts = {
    color: 0xffffff,
    roughness: 0.04,
    metalness: 0.0,
    transmission: 0.98,
    thickness: 0.5,
    ior: 1.5,
    attenuationColor: new THREE.Color(0xeef2ff),
    attenuationDistance: 4.0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.0,
  };
  const glassColumnMat = new THREE.MeshPhysicalMaterial(glassOpts);
  const glassArchMat = new THREE.MeshPhysicalMaterial(glassOpts);

  const columnMatVariants = {
    marble: marbleColumnMat,
    salt: saltColumnMat,
    glass: glassColumnMat,
  };
  const archMatVariants = {
    marble: marbleArchMat,
    salt: saltArchMat,
    glass: glassArchMat,
  };

  const columnMat = columnMatVariants[columnMaterial] ?? marbleColumnMat;
  const archMat = archMatVariants[columnMaterial] ?? marbleArchMat;

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

  const columnMeshes = [];
  // Higher vertical subdivision so the salt displacement map has vertices
  // to push around — 64 radial × 48 vertical = ~6k tris per column.
  // Marble/glass modes don't use displacement so the extra geometry is
  // just dead weight in those modes, but it lets us hot-swap to salt
  // without rebuilding the mesh.
  const columnGeo = new THREE.CylinderGeometry(0.55, 0.65, COL_HEIGHT, 64, 48);
  for (const side of [-1, 1]) {
    const col = new THREE.Mesh(columnGeo, columnMat);
    col.position.set(side * ARCH_INNER, COL_BASE_Y + COL_HEIGHT / 2, 0);
    col.castShadow = true;
    col.receiveShadow = true;
    archGroup.add(col);
    columnMeshes.push(col);

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
  //
  // Bar radius must stay strictly less than the brick gutter, otherwise
  // the cylinder clips into adjacent bricks. Brick footprint is
  // CELL × 0.92, so the gutter per side is (CELL - CELL*0.92) / 2 = CELL*0.04.
  // Use 0.85 × that as the radius to leave a hairline of breathing room.
  const BRICK_GUTTER = CELL * 0.04;          // 0.022 for CELL=0.55
  const GRID_R = BRICK_GUTTER * 0.85;        // ~0.0187, well inside the gutter
  // Landing bar is allowed to be thicker than the gutter — it sits at the
  // bottom edge of the field where there's no neighbour to clip into, and
  // it's offset down by its own radius so the bar's TOP sits flush with
  // the field boundary instead of crossing into the lowest row.
  const LANDING_R = 0.045;

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
  // Landing line — thicker, brighter, signals hard-drop landing position.
  // Offset down by its own radius so the bar's top sits flush with the
  // field boundary instead of poking into the lowest row.
  fieldGroup.add(makeBar(
    new THREE.Vector3(-FIELD_W / 2 - 0.05, -FIELD_H / 2 - LANDING_R, 0),
    new THREE.Vector3(FIELD_W / 2 + 0.05, -FIELD_H / 2 - LANDING_R, 0),
    LANDING_R, landingMat,
  ));
  archGroup.add(fieldGroup);

  const piecesGroup = new THREE.Group();
  archGroup.add(piecesGroup);

  // Hot-swap helper — replaces the material on the column shafts and the
  // arch curve without rebuilding the scene. Cheap because all variants
  // are already constructed; we just swap the .material references.
  function setColumnMaterial(name) {
    const cm = columnMatVariants[name] ?? marbleColumnMat;
    const am = archMatVariants[name] ?? marbleArchMat;
    for (const m of columnMeshes) m.material = cm;
    arch.material = am;
  }

  return {
    scene, archGroup, piecesGroup,
    dimableLights, lampShadeMaterials,
    setColumnMaterial,
  };
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
