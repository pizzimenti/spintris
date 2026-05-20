import * as THREE from 'three';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { Tetris, COLS, ROWS } from './tetris.js';
import { buildScene, createBrick, cellPosition } from './world.js';
import { ParticleField, CameraShake } from './effects.js';

const canvas = document.getElementById('game');
const loadingEl = document.getElementById('loading');
const backendEl = document.getElementById('backend');

const renderer = new THREE.WebGPURenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
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
// AgX is more filmic than ACES, especially in the shadow→midtone ramp.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

backendEl.textContent = renderer.backend?.isWebGPUBackend ? 'WEBGPU' : 'WEBGL2';

const anisotropy = renderer.capabilities?.getMaxAnisotropy?.() ?? 1;
const { scene, archGroup, piecesGroup } = buildScene({ anisotropy });

// Procedural studio environment → PMREM cubemap → IBL for every PBR material.
// Cheap, no HDR file download, and gives every clearcoat surface something to
// reflect (so the marble actually reads as polished).
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
scene.environment = envTex;
scene.environmentIntensity = 0.4;

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 100);
camera.position.set(0, 4.0, 17);
camera.lookAt(0, -1.2, 0);

const shake = new CameraShake(camera);

// Node-based postprocessing.
const renderPipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const scenePassColor = scenePass.getTextureNode('output');
const bloomPass = bloom(scenePassColor, 0.32, 0.45, 0.85);
renderPipeline.outputNode = scenePassColor.add(bloomPass);

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
      archGroup.rotation.y = 0;
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
    archGroup.rotation.y += dt * game.spinSpeed;
  }

  // Pulse the active piece's emissive.
  pulse += dt * 4.5;
  const intensity = 0.5 + Math.sin(pulse) * 0.2;
  const first = activeGroup.children[0];
  if (first && 'emissiveIntensity' in first.material) {
    first.material.emissiveIntensity = intensity;
  }

  particles.update(dt);
  shake.update(dt);

  renderPipeline.render();
}

refresh(true);
loadingEl.classList.add('hide');
renderer.setAnimationLoop(animate);
