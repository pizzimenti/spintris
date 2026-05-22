import * as THREE from 'three';
import { COLS, ROWS } from './tetris.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { LavaLamp } from './lava-lamp.js';
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

// ---- Salt-lamp geometry generator -------------------------------------
//
// Builds a single irregular salt-rock column by merging several overlapping
// deformed icosahedron "chunks" along the vertical axis. Each chunk is a
// sphere perturbed by multi-octave pseudo-noise (different seed phase per
// chunk so they don't look identical). About 30% of the chunks are 1.5×
// the base radius — random "bulge" sections that flare out, with all the
// stranger overhangs/random faces the user wants.
//
// Vertex displacement is BIASED OUTWARD (range -0.4×amp .. +1.0×amp), so
// the effective minimum radius of every chunk stays above the base radius
// times ~0.86 — comfortably thicker than the marble cylinder's 0.65 top.
function makeSaltLampGeometry(totalHeight, baseRadius, seedPhase = 0) {
  // 8 chunks for an 11-unit column means ~1.57u between chunk centers.
  // Base chunk radius 0.85 with outward-biased displacement (effective
  // radius ~0.84 .. 1.11) more than spans that, so adjacent chunks
  // OVERLAP and merge into a continuous irregular silhouette instead
  // of reading as a stack of beads.
  const chunkCount = 8;
  const chunks = [];

  for (let i = 0; i < chunkCount; i++) {
    const t = i / (chunkCount - 1);
    const baseY = -totalHeight / 2 + t * totalHeight;

    // ~30% of chunks bulge to 1.5× radius for thick irregular sections.
    const isBulge = Math.random() < 0.3;
    const radiusMul = isBulge ? 1.5 : 0.95 + Math.random() * 0.20;
    const chunkRadius = baseRadius * radiusMul;

    // Small lateral wobble — adjacent chunks misalign slightly, creating
    // overhangs where one bulges out further than its neighbor.
    const xOff = (Math.random() - 0.5) * baseRadius * 0.30;
    const zOff = (Math.random() - 0.5) * baseRadius * 0.30;

    // Detail 4 → 1280 tris per chunk × 8 × 2 cols = 20k tris.
    // Higher detail looked worse — more triangles = more visible
    // wireframe pattern under noise. Smoothness comes from LOWER
    // noise frequency below, not from more triangles.
    const geo = new THREE.IcosahedronGeometry(chunkRadius, 4);
    geo.computeVertexNormals();
    const positions = geo.attributes.position;
    const normals = geo.attributes.normal;
    const v = new THREE.Vector3(), n = new THREE.Vector3();

    for (let j = 0; j < positions.count; j++) {
      v.fromBufferAttribute(positions, j);
      n.fromBufferAttribute(normals, j);

      // Multi-octave noise. Low base frequency (1.2 vs 2.4 before) so
      // adjacent triangles get SIMILAR perturbation values — that's
      // what kills the visible wireframe pattern. Higher-frequency
      // octaves contribute less so they add detail without crisp edges.
      const px = v.x * 1.2 + seedPhase + i * 11.7;
      const py = v.y * 1.2;
      const pz = v.z * 1.2;
      const o1 = Math.sin(px) * Math.cos(py * 1.3) * Math.sin(pz * 0.9);
      const o2 = Math.sin(px * 2.1 + pz * 1.5) * Math.cos(py * 1.8) * 0.40;
      const o3 = Math.sin(py * 3.5 + pz * 2.4) * Math.cos(px * 3.1) * 0.18;
      const noise = (o1 + o2 + o3);

      // Bias outward so concavities don't carve below nominal radius.
      const amp = chunkRadius * 0.28;
      const displacement = (noise * 0.5 + 0.45) * amp;
      v.addScaledVector(n, displacement);
      v.x += xOff;
      v.y += baseY;
      v.z += zOff;
      positions.setXYZ(j, v.x, v.y, v.z);
    }
    positions.needsUpdate = true;
    geo.computeVertexNormals();
    chunks.push(geo);
  }

  // Merge, then weld nearby vertices across chunks. Chunks overlap by
  // design so some vertices end up coincident; welding them eliminates
  // the visible crease at chunk-junction boundaries.
  let merged = BufferGeometryUtils.mergeGeometries(chunks);
  merged = BufferGeometryUtils.mergeVertices(merged, 0.05);
  merged.computeVertexNormals();
  return merged;
}

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
  // Split into TWO groups so salt mode can treat them differently:
  //   - ambientLights: hemi, key, fill, rim, accent. Tweened to BLACK in
  //     salt mode (the user wants real darkness, not just dimness).
  //   - standLampLights: the 4 corner stand-lamp point lights. Tweened
  //     to a faint base in salt mode, then a per-frame flicker modulates
  //     them on top to read as "Edison bulbs barely keeping alight".
  // lampShadeMaterials tracks the corresponding glowing globe meshes so
  // their emissive fades in lockstep with their point light.
  const ambientLights = [];
  const standLampLights = [];
  const lampShadeMaterials = [];

  const hemi = new THREE.HemisphereLight(0xa6b8ff, 0x2a1f10, 0.35);
  scene.add(hemi);
  ambientLights.push(hemi);

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
  ambientLights.push(key);

  const fill = new THREE.DirectionalLight(0x6080ff, 0.75);
  fill.position.set(-12, 6, -8);
  scene.add(fill);
  ambientLights.push(fill);

  const rim = new THREE.DirectionalLight(0xff8866, 0.6);
  rim.position.set(0, 4, -14);
  scene.add(rim);
  ambientLights.push(rim);

  const accent = new THREE.PointLight(0xffd699, 1.6, 16, 1.4);
  accent.position.set(0, 0, 4);
  scene.add(accent);
  ambientLights.push(accent);

  // ---- Corner lava lamps ------------------------------------------------
  //
  // Four GIANT lava lamps in the corners. Each is a full lava-lamp tower
  // (heavy metallic base + tall glass vessel with rising/falling emissive
  // wax blobs simulated via simple buoyancy+damping integrator + dome
  // cap) with its own PointLight at the bulb position. These are now the
  // primary "stand lamps" — they replace the old pole+globe setup.
  const LAMP_OFFSET = 6.5;
  const lampPositions = [
    [+LAMP_OFFSET, +LAMP_OFFSET],
    [-LAMP_OFFSET, +LAMP_OFFSET],
    [+LAMP_OFFSET, -LAMP_OFFSET],
    [-LAMP_OFFSET, -LAMP_OFFSET],
  ];
  const lavaLamps = [];
  for (let i = 0; i < lampPositions.length; i++) {
    const [px, pz] = lampPositions[i];
    const lamp = new LavaLamp({
      height: 7.5,
      vesselRadius: 0.55,
      blobCount: 7,
      // Stagger colors across lamps so the corners read distinct from
      // each other (cool warm, hot warm, mostly-pink, mostly-orange).
      blobPalette: [
        [0xff5040, 0xff7038, 0xff4070, 0xff9050, 0xff3060, 0xff8848, 0xff6028],
        [0xff4060, 0xff3848, 0xff5080, 0xff6878, 0xff2858, 0xff7068, 0xff4838],
        [0xff7038, 0xff5028, 0xff8848, 0xff9858, 0xff6038, 0xffa060, 0xff7048],
        [0xff5080, 0xff4070, 0xff60a0, 0xff5090, 0xff3878, 0xff7898, 0xff4868],
      ][i],
    });
    lamp.position.set(px, FLOOR_Y, pz);
    scene.add(lamp);
    lavaLamps.push(lamp);

    // The lamp's own bulb PointLight is what we register with the
    // stand-lamp transition / flicker system.
    standLampLights.push(lamp.bulbLight);
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

  // Salt — Himalayan salt lamp. Real PBR rock texture (Poly Haven
  // red_sandstone_pavement) for albedo/normal/roughness so the surface
  // detail reads as crystalline rock rather than procedural noise. A
  // procedural opacity mask still drives the white-vein-blocks-light
  // effect on transmission and emissive (the photo texture doesn't
  // have isolatable veins to mask).
  const saltColorBase = makeSaltColorTexture(1024);  // kept for vein mask
  const saltVeinMask = makeOpacityVeinMapFromColor(saltColorBase, 2.2);
  saltVeinMask.anisotropy = anisotropy;
  saltVeinMask.wrapS = saltVeinMask.wrapT = THREE.RepeatWrapping;
  saltVeinMask.needsUpdate = true;

  const texLoader = new THREE.TextureLoader();
  const saltColor = texLoader.load('assets/salt/diff.jpg');
  saltColor.colorSpace = THREE.SRGBColorSpace;
  saltColor.wrapS = saltColor.wrapT = THREE.RepeatWrapping;
  saltColor.anisotropy = anisotropy;
  const saltNormal = texLoader.load('assets/salt/nor.jpg');
  saltNormal.wrapS = saltNormal.wrapT = THREE.RepeatWrapping;
  saltNormal.anisotropy = anisotropy;
  const saltRough = texLoader.load('assets/salt/rough.jpg');
  saltRough.wrapS = saltRough.wrapT = THREE.RepeatWrapping;
  saltRough.anisotropy = anisotropy;

  // Salt material — very transparent, very bright emissive. The actual
  // chunky/overhang silhouette comes from the salt-lamp geometry (built
  // below), NOT a displacement map — a deformed icosahedron can have
  // overhangs that a displacement-on-cylinder cannot.
  const saltOpts = {
    color: 0xff8a78,
    map: saltColor,
    normalMap: saltNormal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: saltRough,
    roughness: 0.85,
    metalness: 0.0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.45,
    // Opaque. Earlier attempts at transmission + transparency on the
    // 20k-tri salt-blob geometry destroyed frame rate. The "lit from
    // within" effect is carried entirely by emissive + the inner
    // PointLights — real backlit Himalayan salt looks like solid
    // glowing rock anyway.
    emissive: 0xff6c30,
    emissiveIntensity: 2.6,
    emissiveMap: saltVeinMask,  // white veins → no inner glow there
    envMapIntensity: 0.25,
  };
  const saltColumnMat = new THREE.MeshPhysicalMaterial(saltOpts);
  // Arch stays marble in salt mode — the salt columns "support" the arch,
  // which is structurally a separate material. (saltArchMat removed.)

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
  // Arch material variants intentionally treat 'salt' as marble — in
  // salt mode the columns are salt but the arch stays marble (the lamps
  // "support" the arch; different material).
  const archMatVariants = {
    marble: marbleArchMat,
    salt: marbleArchMat,
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
  // Cylinder used by marble + glass modes. Single vertical segment is
  // fine — neither material uses displacement.
  const columnCylinderGeo = new THREE.CylinderGeometry(0.55, 0.65, COL_HEIGHT, 64, 1);
  // Two distinct salt-lamp blobs — each column gets its own irregular
  // shape (the seedPhase makes the noise field differ between them).
  // Base radius 0.85 — even the thinnest section of the salt lamp
  // (effective min radius ≈ 0.84) stays thicker than the marble
  // cylinder's 0.65 top, and the bulge chunks flare to ~1.28+. Per
  // the brief: "thicker than the other columns at their smallest
  // radius and even thicker in sections by 1.5× at random intervals."
  const columnSaltGeos = [
    makeSaltLampGeometry(COL_HEIGHT, 0.85, 0.0),
    makeSaltLampGeometry(COL_HEIGHT, 0.85, 3.7),
  ];
  // Each column tracks both geometry options so we can hot-swap on
  // material change without rebuilding meshes.
  const columnGeoSets = columnSaltGeos.map(saltGeo => ({
    cylinder: columnCylinderGeo,
    salt: saltGeo,
  }));

  let geoIdx = 0;
  for (const side of [-1, 1]) {
    const initialGeo = (columnMaterial === 'salt')
      ? columnGeoSets[geoIdx].salt
      : columnGeoSets[geoIdx].cylinder;
    const col = new THREE.Mesh(initialGeo, columnMat);
    col.position.set(side * ARCH_INNER, COL_BASE_Y + COL_HEIGHT / 2, 0);
    col.castShadow = true;
    col.receiveShadow = true;
    archGroup.add(col);
    columnMeshes.push(col);
    geoIdx++;

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

  // ---- Salt internal point lights ---------------------------------------
  //
  // One PointLight inside each salt column, warm amber, casts on the floor
  // so the area around the columns picks up that orange salt-lamp glow.
  // Off (intensity 0) by default — only fires up in salt mode.
  const SALT_LIGHT_TARGET = 14;
  const saltColumnLights = [];
  for (const side of [-1, 1]) {
    const light = new THREE.PointLight(0xff7030, 0, 9, 1.6);
    light.position.set(side * ARCH_INNER, COL_BASE_Y + COL_HEIGHT * 0.55, 0);
    light.userData.targetIntensity = SALT_LIGHT_TARGET;
    scene.add(light);
    saltColumnLights.push(light);
  }
  // If we're booting straight into salt mode, light them up immediately.
  if (columnMaterial === 'salt') {
    for (const l of saltColumnLights) l.intensity = SALT_LIGHT_TARGET;
  }

  // Hot-swap helper — swaps the material AND the geometry on the columns.
  // Salt mode flips to the irregular icosahedron blob; marble/glass go
  // back to the smooth cylinder.
  function setColumnMaterial(name) {
    const cm = columnMatVariants[name] ?? marbleColumnMat;
    const am = archMatVariants[name] ?? marbleArchMat;
    for (let i = 0; i < columnMeshes.length; i++) {
      columnMeshes[i].material = cm;
      columnMeshes[i].geometry = (name === 'salt')
        ? columnGeoSets[i].salt
        : columnGeoSets[i].cylinder;
    }
    arch.material = am;
  }

  return {
    scene, archGroup, piecesGroup,
    ambientLights, standLampLights, lampShadeMaterials, saltColumnLights, lavaLamps,
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
    // Stained-glass brick — ALPHA-transparent rather than refractive.
    // three.js transmission shares a single per-frame backdrop snapshot
    // that excludes every transmissive object, so a transmissive brick
    // is invisible THROUGH any other transmissive surface (the glass
    // column, the lava-lamp glass, etc). Using plain alpha-transparency
    // means the brick alpha-blends correctly through any number of
    // transparent layers in front of it, while the strong emissive
    // still casts the brick's color onto the floor below (the
    // "stained-glass on floor" effect was always driven by emissive
    // contribution, not by transmission — so we don't lose that).
    mat = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: mode === 'active' ? 1.6 : 1.1,
      roughness: 0.15,
      metalness: 0.0,
      transparent: true,
      opacity: 0.72,
      clearcoat: 0.9,
      clearcoatRoughness: 0.05,
      envMapIntensity: 0.6,
    });
  }
  matCache.set(key, mat);
  return mat;
}

export function createBrick(color, mode = 'settled') {
  const mesh = new THREE.Mesh(brickGeo, getBrickMaterial(color, mode));
  if (mode !== 'ghost') {
    // No castShadow — stained-glass bricks shouldn't block light. The
    // floor sees colored emissive contribution from each brick instead
    // of a hard dark shadow, which is the actual visual we want.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  }
  return mesh;
}
