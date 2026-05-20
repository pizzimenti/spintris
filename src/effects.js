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
}

// Tiny camera-shake utility — call kick() on impact, then update() per frame.
// Trauma decays linearly; offset is trauma² so big shakes drop off naturally.
export class CameraShake {
  constructor(camera) {
    this.camera = camera;
    this.base = camera.position.clone();
    this.trauma = 0;
  }

  setBase(v) { this.base.copy(v); }

  kick(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  update(dt) {
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma;
      this.camera.position.set(
        this.base.x + (Math.random() - 0.5) * s * 0.6,
        this.base.y + (Math.random() - 0.5) * s * 0.4,
        this.base.z + (Math.random() - 0.5) * s * 0.3
      );
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    } else if (!this.camera.position.equals(this.base)) {
      this.camera.position.copy(this.base);
    }
  }
}
