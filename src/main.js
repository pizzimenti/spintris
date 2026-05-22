import * as THREE from 'three';
import {
  pass, mrt, output, normalView, metalness, roughness, velocity,
  directionToColor, colorToDirection, vec2, vec3, vec4, sample,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { Tetris, COLS, ROWS } from './tetris.js';
import { buildScene, createBrick, cellPosition } from './world.js';
import { makeWarehouseEnvironment } from './textures.js';
import { ParticleField, CameraShake, LightTransition } from './effects.js';
import { log, reportRenderer, reportScene, startFrameMonitor, isDebug } from './diag.js';

const canvas = document.getElementById('game');
const loadingEl = document.getElementById('loading');
const backendEl = document.getElementById('backend');

log.info('boot · UA: ' + navigator.userAgent);

// ---- Quality presets ----------------------------------------------------
//
// Selected via the in-game slider; persisted in localStorage; URL ?quality=
// overrides. Each preset chooses what's expensive to enable, since several
// of these levers (forceWebGL, samples, shadowMapSize) can only be set at
// renderer construction time — changing them mid-session requires a reload.
// MSAA samples MUST be 1 (off) whenever TRAA is enabled — per the TRAANode
// docs, "MSAA must be disabled when TRAA is in use" (it confuses TRAA's
// temporal reprojection and breaks the AA pass). Only the low preset, which
// uses no temporal AA, can ask for MSAA.
const QUALITY_PRESETS = {
  low: {
    label: 'low',
    forceWebGL: true,        // skip WebGPU even when available; fewer surprises
    samples: 1,              // no MSAA (no temporal AA either; just FXAA-free)
    antialias: false,
    pixelRatioCap: 1,
    shadowMapSize: 1024,
    shadowType: 'PCF',
    passes: { gtao: false, ssgi: false, ssr: false, bloom: true,  traa: false, denoise: false },
  },
  medium: {
    label: 'medium',
    forceWebGL: false,
    samples: 1,              // TRAA on → MSAA off
    antialias: false,
    pixelRatioCap: 1.5,
    shadowMapSize: 2048,
    shadowType: 'PCFSoft',
    passes: { gtao: true,  ssgi: false, ssr: true,  bloom: true,  traa: true,  denoise: false },
  },
  high: {
    label: 'high',
    forceWebGL: false,
    samples: 1,              // TRAA on → MSAA off
    antialias: false,
    pixelRatioCap: 2,
    shadowMapSize: 4096,
    shadowType: 'PCFSoft',
    // SSGI is the heavy hitter — on the WebGL2 fallback path it can drop
    // frame rate to <1 fps. Backend-gated below in the pass-resolution
    // step so first-run users on browsers without WebGPU don't land in
    // an unplayable configuration.
    passes: { gtao: true,  ssgi: true,  ssr: true,  bloom: true,  traa: true,  denoise: true },
  },
};

function resolveQuality() {
  const url = new URLSearchParams(location.search).get('quality');
  const stored = (() => { try { return localStorage.getItem('spintris.quality'); } catch { return null; } })();
  const pick = url || stored || 'high';
  return QUALITY_PRESETS[pick] ? pick : 'high';
}
const qualityName = resolveQuality();
const quality = QUALITY_PRESETS[qualityName];
log.info(`quality preset: ${qualityName}`);

const renderer = new THREE.WebGPURenderer({
  canvas,
  antialias: quality.antialias,
  samples: quality.samples,
  forceWebGL: quality.forceWebGL,
  powerPreference: 'high-performance',
  precision: 'highp',
  stencil: false,
});

try {
  await renderer.init();
} catch (err) {
  loadingEl.textContent = 'GPU INIT FAILED';
  console.error('Renderer init failed:', err);
  throw err;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
renderer.shadowMap.enabled = quality.shadowMapSize > 0;
renderer.shadowMap.type = quality.shadowType === 'PCFSoft' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

backendEl.textContent = renderer.backend?.isWebGPUBackend ? 'WEBGPU' : 'WEBGL2';

// Diagnostics dump is for ?debug=1 only — gate the heavy GPU-info /
// extension-list / texture-audit walks behind the same flag as the
// frame HUD. Otherwise a normal page load pays the cost of a full
// renderer / extension introspection on every refresh.
if (isDebug) reportRenderer(renderer);

// renderer.capabilities.getMaxAnisotropy() returns 1 under both the WebGPU
// backend and the WebGL2 fallback on this driver (capabilities proxy doesn't
// propagate the underlying limit). Override:
//   - WebGL2 path: query EXT_texture_filter_anisotropic directly.
//   - WebGPU path: pin to 16 (the WebGPU spec maximum for samplers).
function detectMaxAnisotropy() {
  const reported = renderer.capabilities?.getMaxAnisotropy?.() ?? 1;
  const ctx = renderer.getContext?.();
  // WebGL2: query the EXT
  if (ctx && typeof ctx.getParameter === 'function') {
    const ext = ctx.getExtension('EXT_texture_filter_anisotropic');
    const direct = ext ? ctx.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    if (direct > reported) {
      log.warn(`capabilities reported anisotropy ${reported} but GL EXT reports ${direct} — using ${direct}`);
      return direct;
    }
    return reported;
  }
  // WebGPU: spec-mandated max is 16 for any conformant adapter.
  if (renderer.backend?.isWebGPUBackend) {
    log.warn(`capabilities reported anisotropy ${reported} — pinning to 16 (WebGPU spec maximum)`);
    return 16;
  }
  return reported;
}
const anisotropy = detectMaxAnisotropy();
log.info(`anisotropy in use: ${anisotropy}`);

// Column material — persisted in localStorage, URL ?columns= overrides.
// 'marble' is the default PBR pink marble; 'salt' is rough Himalayan-pink-salt
// with transmission + warm emissive glow; 'glass' is a near-clear crystal.
function resolveColumnMaterial() {
  const url = new URLSearchParams(location.search).get('columns');
  const stored = (() => { try { return localStorage.getItem('spintris.columns'); } catch { return null; } })();
  const pick = url || stored || 'marble';
  return ['marble', 'salt', 'glass'].includes(pick) ? pick : 'marble';
}
const columnMaterial = resolveColumnMaterial();
log.info(`column material: ${columnMaterial}`);

const {
  scene, archGroup, piecesGroup,
  ambientLights, standLampLights, lampShadeMaterials, saltColumnLights, lavaLamps,
  setColumnMaterial: applyColumnMaterial,
} = buildScene({
  anisotropy,
  shadowMapSize: quality.shadowMapSize,
  columnMaterial,
});

// Salt mode adds its OWN bright internal lights (the lamps' bulbs). These
// are instantly toggled by setSaltLights — they don't participate in the
// dim/brighten ambient tween. Off everywhere except salt.
function setSaltLightsOn(on) {
  for (const l of saltColumnLights) {
    l.intensity = on ? l.userData.targetIntensity : 0;
  }
}

// Per-lamp captured originals — just the bulb PointLight from each
// lava lamp now (the old shade-emissive globes are gone; their stand-in
// is the blob ensemble inside the lava lamp, which has its own life).
const standLampOriginals = standLampLights.map((l, i) => ({
  light: l, lightFull: l.intensity, phase: i * 1.83,
}));
// Edison-bulb flicker: very low base intensity with multi-frequency
// sine modulation + per-frame jitter + occasional deeper dip. Async
// phase per lamp.
let saltFlickerActive = false;
let flickerT = 0;
function updateSaltFlicker(dt) {
  if (!saltFlickerActive) return;
  flickerT += dt;
  for (const o of standLampOriginals) {
    const f1 = Math.sin(flickerT * 7.0 + o.phase);
    const f2 = Math.sin(flickerT * 23.0 + o.phase * 1.3) * 0.5;
    const f3 = (Math.random() - 0.5) * 0.35;
    const dip = (Math.sin(flickerT * 1.7 + o.phase) > 0.93) ? -0.35 : 0;
    const k = Math.max(0.015, 0.06 + (f1 + f2 + f3) * 0.018 + dip * 0.02);
    o.light.intensity = o.lightFull * k;
  }
}

// Two independent LightTransitions:
//   - ambient (hemi/key/fill/rim/accent) → 0 in salt (real darkness)
//   - stand lamps (4 corner lights + their shade emissives) → 0 in salt;
//     the flicker function then drives a faint 4-8% modulation on top.
const ambientTransition = new LightTransition(ambientLights, []);
const standLampTransition = new LightTransition(standLampLights, lampShadeMaterials);
if (columnMaterial === 'salt') {
  ambientTransition.setLevel(0);
  standLampTransition.setLevel(0); // flicker writes intensity directly each frame
  saltFlickerActive = true;
}

// Active column material (mutable — the slider can change it at runtime).
let currentColumnMaterial = columnMaterial;

// Warehouse-style environment map → PMREM cubemap → IBL for every PBR
// material. Painted canvas equirectangular: dim warm ceiling with bright
// fluorescent strips overhead. The polished concrete floor's clearcoat
// picks these up as crisp specular highlights — the defining visual of
// the reference photo. RoomEnvironment is the fallback used for surfaces
// when the warehouse env's bright strips would be too harsh.
const pmrem = new THREE.PMREMGenerator(renderer);
const warehouseCanvas = makeWarehouseEnvironment();
const warehouseTex = new THREE.CanvasTexture(warehouseCanvas);
warehouseTex.mapping = THREE.EquirectangularReflectionMapping;
warehouseTex.colorSpace = THREE.SRGBColorSpace;
const envTex = pmrem.fromEquirectangular(warehouseTex).texture;
warehouseTex.dispose();
scene.environment = envTex;
scene.environmentIntensity = 0.95;

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 100);

// Camera orbits the static arch instead of the arch spinning in place — the
// columns belong to the floor, so it has to be the viewer who walks around.
// The disorientation gameplay still works: piece motion is in world-X, so
// when the camera is behind the field, LEFT visually moves the piece RIGHT.
const ORBIT_RADIUS = 17;
const ORBIT_HEIGHT = 4.0;
const ORBIT_LOOK_Y = -1.2;
let orbitAngle = 0;

function positionOrbit() {
  camera.position.set(
    Math.sin(orbitAngle) * ORBIT_RADIUS,
    ORBIT_HEIGHT,
    Math.cos(orbitAngle) * ORBIT_RADIUS,
  );
  camera.lookAt(0, ORBIT_LOOK_Y, 0);
}
positionOrbit();

const shake = new CameraShake();

// Node-based postprocessing.
//
// Each pass is toggleable via URL query so we can A/B perf:
//   ?ssgi=0  ?ssr=0  ?gtao=0  ?traa=0  ?bloom=0
// Default: SSGI off (it tanks frame rate to <1fps on this WebGL2 backend);
// AO + SSR + bloom + TRAA on.
// Pass enablement starts from the quality preset and is overridable per-pass
// via URL query (?ssgi=0, ?gtao=1, etc.) for ad-hoc testing without
// recompiling.
//
// SSGI on the WebGL2 fallback path drops frame rate to <1 fps on this class
// of integrated GPU, so we force it off when the WebGPU backend isn't active
// — otherwise first-run users on browsers without WebGPU and on the High
// preset land in an effectively unplayable configuration. URL ?ssgi=1 still
// overrides if someone explicitly wants to try it.
const onWebGPU = !!renderer.backend?.isWebGPUBackend;
const passes = {
  gtao:    getFlag('gtao',    quality.passes.gtao),
  ssgi:    getFlag('ssgi',    quality.passes.ssgi && onWebGPU),
  ssr:     getFlag('ssr',     quality.passes.ssr),
  bloom:   getFlag('bloom',   quality.passes.bloom),
  traa:    getFlag('traa',    quality.passes.traa),
  denoise: getFlag('denoise', quality.passes.denoise),
};
if (quality.passes.ssgi && !onWebGPU) {
  log.warn('quality wants SSGI but backend is WebGL2 — SSGI disabled to keep playable fps; use ?ssgi=1 to force');
}
function getFlag(name, dflt) {
  const v = new URLSearchParams(location.search).get(name);
  if (v === null) return dflt;
  return v !== '0' && v !== 'false';
}
log.info('postprocess passes:', passes);

const renderPipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({
  output,
  normal: directionToColor(normalView),
  metalrough: vec2(metalness, roughness),
  velocity,
}));

const sceneColor = scenePass.getTextureNode('output');
const sceneNormalTex = scenePass.getTextureNode('normal');
const sceneDepth = scenePass.getTextureNode('depth');
const sceneMetalRough = scenePass.getTextureNode('metalrough');
const sceneVelocity = scenePass.getTextureNode('velocity');
const sceneNormal = sample(uv => colorToDirection(sceneNormalTex.sample(uv)));

let composed = sceneColor;

if (passes.gtao) {
  const aoPass = ao(sceneDepth, sceneNormal, camera);
  const aoTexture = aoPass.getTextureNode();
  composed = composed.mul(vec4(vec3(aoTexture.r), 1.0));
}

if (passes.ssgi) {
  const ssgiPass = ssgi(sceneColor, sceneDepth, sceneNormal, camera);
  const ssgiOut = passes.denoise
    ? denoise(ssgiPass, sceneDepth, sceneNormal, camera)
    : ssgiPass;
  composed = composed.add(ssgiOut);
}

if (passes.ssr) {
  const ssrPass = ssr(sceneColor, sceneDepth, sceneNormal, sceneMetalRough.r, sceneMetalRough.g);
  const ssrOut = passes.denoise
    ? denoise(ssrPass, sceneDepth, sceneNormal, camera).rgb
    : ssrPass.rgb;
  composed = composed.add(ssrOut);
}

if (passes.bloom) {
  composed = composed.add(bloom(composed, 0.32, 0.45, 0.85));
}

renderPipeline.outputNode = passes.traa
  ? traa(composed, sceneDepth, sceneVelocity, camera)
  : composed;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- Engine HUD + quality slider ----

const eng = {
  backend: document.getElementById('eng-backend'),
  fps:     document.getElementById('eng-fps'),
  pixels:  document.getElementById('eng-pixels'),
};

const isWebGPU = !!renderer.backend?.isWebGPUBackend;
eng.backend.textContent = isWebGPU ? 'WebGPU' : 'WebGL 2';

// Resolution / pixel ratio
function updatePixels() {
  const w = renderer.domElement.width, h = renderer.domElement.height;
  eng.pixels.textContent = `${w}×${h} (${renderer.getPixelRatio().toFixed(2)}×)`;
}
updatePixels();
window.addEventListener('resize', updatePixels);

// Rolling FPS / frame-time / load buffer, polled into the HUD every 500ms.
// GPU temperature and utilisation aren't exposed by any browser API; closest
// honest proxy is frame-time ÷ 16.67ms-budget displayed as a "GPU load %".
const SAMPLES = 60;
const dtBuf = [];
let dtLast = performance.now();

function tickEngineSample() {
  const now = performance.now();
  dtBuf.push(now - dtLast);
  dtLast = now;
  if (dtBuf.length > SAMPLES) dtBuf.shift();
}

setInterval(() => {
  if (!dtBuf.length) return;
  const sorted = [...dtBuf].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  eng.fps.textContent = `${(1000 / median).toFixed(0)}`;
}, 500);

// Quality slider — highlight current, save+reload on click.
for (const btn of document.querySelectorAll('#quality button')) {
  if (btn.dataset.q === qualityName) btn.classList.add('active');
  btn.addEventListener('click', () => {
    if (btn.dataset.q === qualityName) return;
    try { localStorage.setItem('spintris.quality', btn.dataset.q); } catch {}
    // Strip any ?quality= URL override so the new stored choice wins.
    const u = new URL(location.href);
    u.searchParams.delete('quality');
    location.href = u.toString();
  });
}

// Column material slider — HOT SWAP (no reload). Entering salt fades the
// rest of the scene's lighting down before the salt lamp's emissive
// takes over; exiting salt swaps the material instantly (kills the
// emissive) and then ramps the lights back up. Marble↔Glass is a plain
// instant swap because neither needs the lighting pivot.
function setColumnMaterialAnimated(name) {
  if (name === currentColumnMaterial) return;
  const cmBtns = document.querySelectorAll('#column-mat button');
  // update button highlight immediately so the UI doesn't feel laggy
  for (const b of cmBtns) b.classList.toggle('active', b.dataset.cm === name);
  try { localStorage.setItem('spintris.columns', name); } catch {}

  if (name === 'salt') {
    // Dim both ambient and stand lamps to zero, THEN swap material,
    // turn on the salt internal lights, and engage the Edison flicker
    // so the stand lamps come back with a faint modulated glow.
    ambientTransition.tweenTo(0, 1.6);
    standLampTransition.tweenTo(0, 1.6, () => {
      applyColumnMaterial('salt');
      setSaltLightsOn(true);
      saltFlickerActive = true;
      currentColumnMaterial = 'salt';
    });
  } else if (currentColumnMaterial === 'salt') {
    // Coming OUT of salt: kill salt emissive + internal lights + flicker
    // instantly, then ramp ambient and stand lamps back to full.
    applyColumnMaterial(name);
    setSaltLightsOn(false);
    saltFlickerActive = false;
    currentColumnMaterial = name;
    ambientTransition.tweenTo(1.0, 1.6);
    standLampTransition.tweenTo(1.0, 1.6);
  } else {
    // marble ↔ glass — no lighting change needed, just swap.
    applyColumnMaterial(name);
    currentColumnMaterial = name;
  }
}

for (const btn of document.querySelectorAll('#column-mat button')) {
  if (btn.dataset.cm === columnMaterial) btn.classList.add('active');
  btn.addEventListener('click', () => setColumnMaterialAnimated(btn.dataset.cm));
}

// ---- Game wiring ----

const game = new Tetris();
const particles = new ParticleField(scene);

const boardGroup = new THREE.Group();
const ghostGroup = new THREE.Group();
const activeGroup = new THREE.Group();
piecesGroup.add(boardGroup);
piecesGroup.add(ghostGroup);
piecesGroup.add(activeGroup);

function clearGroup(g) {
  while (g.children.length) g.remove(g.children[0]);
}

function rebuildBoard() {
  clearGroup(boardGroup);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const col = game.board[r][c];
    if (!col) continue;
    const m = createBrick(col, 'settled');
    m.position.copy(cellPosition(c, r));
    boardGroup.add(m);
  }
}

function rebuildActive() {
  clearGroup(activeGroup);
  clearGroup(ghostGroup);
  if (game.gameOver) return;
  const { shape, color } = game.current;
  const gy = game.ghostY();
  for (let r = 0; r < shape.length; r++) for (let c = 0; c < shape[r].length; c++) {
    if (!shape[r][c]) continue;
    const a = createBrick(color, 'active');
    a.position.copy(cellPosition(game.x + c, game.y + r));
    activeGroup.add(a);
    if (gy !== game.y) {
      const g = createBrick(color, 'ghost');
      g.position.copy(cellPosition(game.x + c, gy + r));
      ghostGroup.add(g);
    }
  }
}

function updateHUD() {
  document.getElementById('score').textContent = game.score.toLocaleString();
  document.getElementById('level').textContent = game.level;
  document.getElementById('lines').textContent = game.lines;
}

const overlayEl = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg = document.getElementById('overlay-message');

function showOverlay(title, message) {
  overlayTitle.textContent = title;
  overlayMsg.textContent = message;
  overlayEl.classList.add('show');
}
function hideOverlay() { overlayEl.classList.remove('show'); }

function refresh(rebuildBoardFlag = false) {
  if (rebuildBoardFlag) rebuildBoard();
  rebuildActive();
  updateHUD();
}

// Game-over auto-restart — fires 10s after the run ends unless the user
// hits ESC to stay on the game-over screen, or R to restart immediately.
const AUTO_RESTART_MS = 10_000;
let autoRestartTimer = null;

function doRestart() {
  game.reset();
  particles.clear();    // drop in-flight bursts from the previous run
  shake.reset();        // zero out any decaying camera trauma
  hideOverlay();
  paused = false;
  orbitAngle = 0;
  positionOrbit();
  fallAccum = 0;
  refresh(true);
}

function startAutoRestartTimer() {
  if (autoRestartTimer != null) return;
  autoRestartTimer = setTimeout(() => {
    autoRestartTimer = null;
    if (game.gameOver) doRestart();
  }, AUTO_RESTART_MS);
}

function cancelAutoRestartTimer() {
  if (autoRestartTimer == null) return;
  clearTimeout(autoRestartTimer);
  autoRestartTimer = null;
  // Update the overlay hint so the user knows the auto-restart was cancelled.
  const hint = document.querySelector('#overlay .hint');
  if (hint) hint.innerHTML = 'Press <kbd>R</kbd> to restart';
}

function checkGameOver() {
  if (game.gameOver) {
    showOverlay('GAME OVER', `Final score: ${game.score.toLocaleString()}`);
    const hint = document.querySelector('#overlay .hint');
    if (hint) hint.innerHTML = 'Auto-restart in 10s · <kbd>ESC</kbd> cancel · <kbd>R</kbd> restart now';
    startAutoRestartTimer();
  }
}

// Spawn a particle burst for each cell in the cleared lines.
// `cells` are board coordinates — convert to world coords through piecesGroup
// (which is rotating with the arch) so bursts originate where the bricks were
// rendered at the moment of clear.
function burstClearedCells(cleared) {
  if (!cleared || !cleared.cells.length) return;
  piecesGroup.updateMatrixWorld();
  for (const { row, col, color } of cleared.cells) {
    const local = cellPosition(col, row);
    const world = local.clone().applyMatrix4(piecesGroup.matrixWorld);
    particles.burst(world, color, 9);
  }
  // Multi-line clears feel impactful — give the camera a shake too.
  shake.kick(0.12 + cleared.rows.length * 0.08);
}

let paused = false;
let fallAccum = 0;
let lastTime = performance.now();
let pulse = 0;

window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) {
    e.preventDefault();
  }

  if (game.gameOver) {
    if (e.code === 'KeyR') {
      cancelAutoRestartTimer();
      doRestart();
    } else if (e.code === 'Escape') {
      cancelAutoRestartTimer();
    }
    return;
  }

  if (e.code === 'KeyP') {
    paused = !paused;
    if (paused) showOverlay('PAUSED', 'Press P to resume');
    else hideOverlay();
    return;
  }
  if (paused) return;

  switch (e.code) {
    case 'ArrowLeft':
      if (game.move(-1)) refresh(false);
      break;
    case 'ArrowRight':
      if (game.move(1)) refresh(false);
      break;
    case 'ArrowDown': {
      const r = game.softDrop();
      refresh(r.locked);
      if (r.locked) burstClearedCells(r.cleared);
      checkGameOver();
      break;
    }
    case 'ArrowUp':
    case 'KeyX':
      if (game.rotate(1)) refresh(false);
      break;
    case 'KeyZ':
      if (game.rotate(-1)) refresh(false);
      break;
    case 'Space': {
      const r = game.hardDrop();
      refresh(r.locked);
      if (r.locked) {
        burstClearedCells(r.cleared);
        // Always shake a little on hard drop, scaled with the line clear above.
        shake.kick(0.08);
      }
      checkGameOver();
      break;
    }
  }
}, { passive: false });

function animate() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  if (!paused && !game.gameOver) {
    fallAccum += dt * 1000;
    if (fallAccum >= game.fallInterval) {
      fallAccum = 0;
      const r = game.step();
      refresh(r.locked);
      if (r.locked) burstClearedCells(r.cleared);
      checkGameOver();
    }
    orbitAngle += dt * game.spinSpeed;
  }

  positionOrbit();
  shake.apply(camera, dt);

  // Pulse the active piece's emissive.
  pulse += dt * 4.5;
  const intensity = 0.5 + Math.sin(pulse) * 0.2;
  const first = activeGroup.children[0];
  if (first && 'emissiveIntensity' in first.material) {
    first.material.emissiveIntensity = intensity;
  }

  particles.update(dt);
  ambientTransition.update(dt);
  standLampTransition.update(dt);
  updateSaltFlicker(dt);
  for (const lamp of lavaLamps) lamp.update(dt);

  renderPipeline.render();
  tickEngineSample();
}

refresh(true);
if (isDebug) reportScene(scene);
startFrameMonitor(renderer); // self-gates on isDebug internally
loadingEl.classList.add('hide');
if (isDebug) log.info('debug mode active (use ?debug=1)');
renderer.setAnimationLoop(animate);
