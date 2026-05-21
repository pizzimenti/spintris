import * as THREE from 'three';

// Pool-backed particle burst. Particles are added to the SCENE root (not the
// rotating arch group) so they stay in fixed world coords as the arch keeps
// spinning behind them — looks right when bricks shatter outward.
export class ParticleField {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
    this.pool = [];
    this.geo = new THREE.SphereGeometry(0.06, 8, 6);
  }

  acquire(color) {
    let m = this.pool.pop();
    if (!m) {
      m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }));
    }
    m.material.color.setHex(color);
    m.material.opacity = 1;
    m.scale.setScalar(1);
    return m;
  }

  burst(worldPos, color, count = 10) {
    for (let i = 0; i < count; i++) {
      const m = this.acquire(color);
      m.position.copy(worldPos);
      const a = Math.random() * Math.PI * 2;
      const speed = 2.2 + Math.random() * 3.0;
      const elev = 0.35 + Math.random() * 0.65;
      m.userData.v = new THREE.Vector3(
        Math.cos(a) * speed * (1 - elev),
        elev * speed * 1.6,
        Math.sin(a) * speed * (1 - elev)
      );
      m.userData.t = 0;
      m.userData.life = 0.55 + Math.random() * 0.35;
      this.scene.add(m);
      this.live.push(m);
    }
  }

  update(dt) {
    const g = 9.8;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const m = this.live[i];
      m.userData.v.y -= g * dt;
      m.position.addScaledVector(m.userData.v, dt);
      m.userData.t += dt;
      const k = m.userData.t / m.userData.life;
      m.material.opacity = Math.max(0, 1 - k * k);
      m.scale.setScalar(Math.max(0.25, 1 - k * 0.7));
      if (k >= 1) {
        this.scene.remove(m);
        this.pool.push(m);
        this.live.splice(i, 1);
      }
    }
  }

  // Yank all live particles back to the pool — used on game-restart so
  // a fresh game doesn't start with a previous run's burst still in flight.
  clear() {
    for (const m of this.live) {
      this.scene.remove(m);
      this.pool.push(m);
    }
    this.live.length = 0;
  }
}

// Camera-shake utility — call kick() on impact, then apply() per frame AFTER
// the camera has been positioned by whatever else moves it (orbit, etc).
// Trauma decays linearly; offset is trauma² so big shakes drop off naturally.
export class CameraShake {
  constructor() { this.trauma = 0; }

  kick(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  apply(camera, dt) {
    if (this.trauma <= 0) return;
    const s = this.trauma * this.trauma;
    camera.position.x += (Math.random() - 0.5) * s * 0.6;
    camera.position.y += (Math.random() - 0.5) * s * 0.4;
    camera.position.z += (Math.random() - 0.5) * s * 0.3;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
  }

  // Zero trauma so a fresh game starts with no inherited shake.
  reset() { this.trauma = 0; }
}

// Smoothly fades every supplied light's intensity by a global multiplier,
// plus matching emissive-intensity scaling on a separate list of "shade"
// materials (the glowing globes on the corner stand lamps that should
// dim in lockstep with their point lights). Used for the cinematic
// transition into salt-lamp mode.
export class LightTransition {
  constructor(lights, shadeMaterials) {
    // Snapshot the originals so we can multiply against them every frame
    // — otherwise we'd lose precision and drift over many transitions.
    this.lights = lights.map(l => ({ obj: l, full: l.intensity }));
    this.shades = shadeMaterials.map(m => ({ mat: m, full: m.emissiveIntensity }));
    this.level = 1;
    this.target = 1;
    this.rate = 1.5;        // levels per second
    this.onArrive = null;
    this.apply();
  }

  // Snap to a level immediately (used at boot when initial mode is salt).
  setLevel(level) {
    this.level = this.target = Math.max(0, Math.min(1, level));
    this.onArrive = null;
    this.apply();
  }

  // Animate to a target level. `rate` is levels-per-second.
  // `onArrive` fires when the target is reached.
  tweenTo(level, rate = 1.5, onArrive = null) {
    this.target = Math.max(0, Math.min(1, level));
    this.rate = rate;
    this.onArrive = onArrive;
  }

  update(dt) {
    if (this.level === this.target) {
      if (this.onArrive) {
        const cb = this.onArrive; this.onArrive = null;
        cb();
      }
      return;
    }
    const diff = this.target - this.level;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), this.rate * dt);
    this.level += step;
    this.apply();
    if (this.level === this.target && this.onArrive) {
      const cb = this.onArrive; this.onArrive = null;
      cb();
    }
  }

  apply() {
    const k = this.level;
    for (const l of this.lights) l.obj.intensity = l.full * k;
    for (const s of this.shades) s.mat.emissiveIntensity = s.full * k;
  }
}
