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
import { ParticleField, CameraShake } from './effects.js';
import { log, reportRenderer, reportScene, startFrameMonitor, isDebug } from './diag.js';

const canvas = document.getElementById('game');
const loadingEl = document.getElementById('loading');
const backendEl = document.getElementById('backend');

log.info('boot · UA: ' + navigator.userAgent);

const renderer = new THREE.WebGPURenderer({
  canvas,
  antialias: true,
  // 4× MSAA. The WebGL2 backend advertised maxSamples=8 but on the WebGPU
  // backend asking for 8 dropped framerate to ~0.1 fps on this adapter
  // (Dawn appears to fall off a fast path). 4× is the WebGPU spec-required
  // minimum and well supported.
  samples: 4,
  powerPreference: 'high-performance',
  // Higher precision GLSL when WebGL2 fallback kicks in; on most desktop
  // drivers this is already the default but mobile / integrated GPUs vary.
  precision: 'highp',
  // Force a depth+stencil 24-bit buffer for crisp shadow comparisons.
  stencil: false,
});

try {
  await renderer.init();
} catch (err) {
  loadingEl.textContent = 'GPU INIT FAILED';
  console.error('Renderer init failed:', err);
  throw err;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

backendEl.textContent = renderer.backend?.isWebGPUBackend ? 'WEBGPU' : 'WEBGL2';

reportRenderer(renderer);

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
const { scene, archGroup, piecesGroup } = buildScene({ anisotropy });

// Procedural studio environment → PMREM cubemap → IBL for every PBR material.
// Cheap, no HDR file download, and gives every clearcoat surface something to
// reflect (so the marble actually reads as polished).
const pmrem = new THREE.PMREMGenerator(renderer);
// sigma=0.04 — max effective before three.js logs "too large and will clip".
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex;
scene.environmentIntensity = 0.4;

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
// SSGI defaults on when the WebGPU backend is active — on WebGL2 fallback
// it tanks frame rate to <1 fps. Override either way via ?ssgi=1 / ?ssgi=0.
const onWebGPU = !!renderer.backend?.isWebGPUBackend;
const passes = {
  gtao: getFlag('gtao', true),
  ssgi: getFlag('ssgi', onWebGPU),
  ssr:  getFlag('ssr',  true),
  bloom: getFlag('bloom', true),
  traa: getFlag('traa', true),
};
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
  // SSGI uses stochastic ray-marching; without denoising you see the
  // raw Bayer / blue-noise sample pattern as a halftone overlay around
  // bright contributors (visible on the columns near the falling pieces).
  // Bilateral denoise with depth + normal keeps edges sharp while
  // smoothing the stochastic dither.
  const ssgiPass = ssgi(sceneColor, sceneDepth, sceneNormal, camera);
  const ssgiClean = denoise(ssgiPass, sceneDepth, sceneNormal, camera);
  composed = composed.add(ssgiClean);
}

if (passes.ssr) {
  const ssrPass = ssr(sceneColor, sceneDepth, sceneNormal, sceneMetalRough.r, sceneMetalRough.g);
  const ssrClean = denoise(ssrPass, sceneDepth, sceneNormal, camera);
  composed = composed.add(ssrClean.rgb);
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

function checkGameOver() {
  if (game.gameOver) {
    showOverlay('GAME OVER', `Final score: ${game.score.toLocaleString()}`);
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
      game.reset();
      hideOverlay();
      paused = false;
      orbitAngle = 0;
      positionOrbit();
      fallAccum = 0;
      refresh(true);
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

  renderPipeline.render();
}

refresh(true);
reportScene(scene);
startFrameMonitor(renderer);
loadingEl.classList.add('hide');
if (isDebug) log.info('debug mode active (use ?debug=1)');
renderer.setAnimationLoop(animate);
