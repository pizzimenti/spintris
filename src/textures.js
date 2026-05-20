import * as THREE from 'three';

// Draw grout / seam bands with soft (anti-aliased) edges. `core` is the
// fully-opaque interior width in px; `falloff` is the half-transparent
// fade band on each side. Banks anti-aliasing into the texture so the
// edges don't stairstep when the floor is foreshortened.
function drawSoftBands(ctx, size, tilesPerSide, tilePx, color, core, falloff) {
  const total = core + 2 * falloff;
  const half = total / 2;
  // Parse "#rrggbb" → rgba components for the transparent endpoints.
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const transparent = `rgba(${r}, ${g}, ${b}, 0)`;
  const opaque = color;
  const stopIn = falloff / total;
  const stopOut = 1 - stopIn;

  for (let i = 0; i <= tilesPerSide; i++) {
    const p = i * tilePx;
    // Vertical band
    const gv = ctx.createLinearGradient(p - half, 0, p + half, 0);
    gv.addColorStop(0, transparent);
    gv.addColorStop(stopIn, opaque);
    gv.addColorStop(stopOut, opaque);
    gv.addColorStop(1, transparent);
    ctx.fillStyle = gv;
    ctx.fillRect(p - half, 0, total, size);
    // Horizontal band
    const gh = ctx.createLinearGradient(0, p - half, 0, p + half);
    gh.addColorStop(0, transparent);
    gh.addColorStop(stopIn, opaque);
    gh.addColorStop(stopOut, opaque);
    gh.addColorStop(1, transparent);
    ctx.fillStyle = gh;
    ctx.fillRect(0, p - half, size, total);
  }
}

// ---- Pink marble (columns / arch) --------------------------------------

// Multi-layer canvas painting: peach-pink base, overlapping color blobs for
// natural mottling, then bezier-traced veins in both bright (cream/quartz)
// and dark (oxide / iron-stain) variants. Designed to read as marble at any
// viewing distance, not as obvious procedural noise.
export function makeMarbleColorTexture(size = 2048) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // Warm pink base
  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, '#c88a82');
  base.addColorStop(0.5, '#d49a92');
  base.addColorStop(1, '#b87870');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Big soft color blobs for mottled background variation
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 60 + Math.random() * 220;
    const hue = 4 + Math.random() * 14;
    const sat = 22 + Math.random() * 35;
    const light = 50 + Math.random() * 22;
    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, ${0.05 + Math.random() * 0.10})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bright quartz veins — cream/white winding strokes. High contrast so the
  // marble reads as marble, not as solid pink stone, even at a distance.
  const veinCount = 65;
  for (let i = 0; i < veinCount; i++) {
    const x1 = Math.random() * size;
    const y1 = Math.random() * size;
    const len = 220 + Math.random() * 800;
    const angle = Math.random() * Math.PI * 2;
    const x2 = x1 + Math.cos(angle) * len;
    const y2 = y1 + Math.sin(angle) * len;

    // Multi-segment for organic look
    const segs = 4 + Math.floor(Math.random() * 5);
    ctx.strokeStyle = `rgba(${245 + Math.random() * 10 | 0}, ${225 + Math.random() * 20 | 0}, ${205 + Math.random() * 20 | 0}, ${0.55 + Math.random() * 0.40})`;
    ctx.lineWidth = 0.8 + Math.random() * 3.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    let px = x1, py = y1;
    for (let s = 0; s < segs; s++) {
      const t = (s + 1) / segs;
      const tx = x1 + (x2 - x1) * t + (Math.random() - 0.5) * 110;
      const ty = y1 + (y2 - y1) * t + (Math.random() - 0.5) * 110;
      const cx = (px + tx) / 2 + (Math.random() - 0.5) * 80;
      const cy = (py + ty) / 2 + (Math.random() - 0.5) * 80;
      ctx.quadraticCurveTo(cx, cy, tx, ty);
      px = tx; py = ty;
    }
    ctx.stroke();
  }

  // Dark mineral veins — deeper oxide red, more prominent
  for (let i = 0; i < 28; i++) {
    const x1 = Math.random() * size;
    const y1 = Math.random() * size;
    const angle = Math.random() * Math.PI * 2;
    const len = 180 + Math.random() * 600;
    const x2 = x1 + Math.cos(angle) * len;
    const y2 = y1 + Math.sin(angle) * len;
    ctx.strokeStyle = `rgba(${55 + Math.random() * 35 | 0}, ${22 + Math.random() * 22 | 0}, ${28 + Math.random() * 22 | 0}, ${0.45 + Math.random() * 0.35})`;
    ctx.lineWidth = 0.4 + Math.random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    const cx = (x1 + x2) / 2 + (Math.random() - 0.5) * 140;
    const cy = (y1 + y2) / 2 + (Math.random() - 0.5) * 140;
    ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.stroke();
  }

  // Fine speckles for grit
  for (let i = 0; i < 1200; i++) {
    ctx.fillStyle = Math.random() < 0.5
      ? `rgba(${230 + Math.random() * 20 | 0}, ${200 + Math.random() * 25 | 0}, ${180 + Math.random() * 25 | 0}, ${0.10 + Math.random() * 0.15})`
      : `rgba(${100 + Math.random() * 50 | 0}, ${55 + Math.random() * 30 | 0}, ${60 + Math.random() * 30 | 0}, ${0.12 + Math.random() * 0.15})`;
    const r = 0.6 + Math.random() * 2.4;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  // Keep the source canvas attached so derived maps can sample it.
  tex.userData.canvas = c;
  return tex;
}

// Sobel-style normal derived from the color map's luminance — veins become
// subtle bumps, which is how real marble reads under raking light.
export function makeMarbleNormalFromColor(colorTex, strength = 1.2) {
  const src = colorTex.userData.canvas;
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d');
  const data = sctx.getImageData(0, 0, w, h).data;

  // Luminance buffer
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    lum[i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;
  }

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Wrap-around sampling so the normal tiles seamlessly.
      const xl = (x - 1 + w) % w, xr = (x + 1) % w;
      const yt = (y - 1 + h) % h, yb = (y + 1) % h;
      const dx = (lum[y * w + xr] - lum[y * w + xl]) * strength;
      const dy = (lum[yb * w + x] - lum[yt * w + x]) * strength;

      // Tangent-space normal: (-dx, -dy, 1) normalized → RGB
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;

      const o = (y * w + x) * 4;
      img.data[o]     = (nx * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---- Poured concrete (floor) -------------------------------------------

// Procedural concrete map for a fancy-garage epoxy floor. Single non-tiling
// image covering the full floor plane (wrap=ClampToEdge). Imperfections are
// placed at randomised positions so nothing reads as repeated:
//   - large soft color patches for blotchy pour variation
//   - thousands of fine aggregate flecks
//   - larger pebble inclusions
//   - dark pits & pock marks
//   - hairline cracks (multi-segment quadratic beziers)
//   - light stain / oil blobs
//   - control joints (saw-cut grid) with soft shadow rolloffs
export function makeConcreteColorTexture(size = 2048) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // Base — neutral gray with a slow radial gradient to break up flatness
  const base = ctx.createRadialGradient(
    size * 0.3, size * 0.4, size * 0.05,
    size * 0.55, size * 0.55, size * 0.75,
  );
  base.addColorStop(0, '#6c6f73');
  base.addColorStop(0.5, '#5d6064');
  base.addColorStop(1, '#52555a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Warm + cool color patches — natural pour variation
  for (let i = 0; i < 32; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 180 + Math.random() * 460;
    const warm = Math.random() < 0.5;
    const hue = warm ? 25 + Math.random() * 25 : 200 + Math.random() * 20;
    const sat = 4 + Math.random() * 8;
    const light = 28 + Math.random() * 15;
    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, ${0.06 + Math.random() * 0.08})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fine aggregate — dense pepper of small flecks
  for (let i = 0; i < 9000; i++) {
    const lum = 70 + Math.random() * 70;
    ctx.fillStyle = `rgba(${lum}, ${lum * 0.99 | 0}, ${lum * 0.97 | 0}, ${0.05 + Math.random() * 0.15})`;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 0.5 + Math.random() * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Larger pebbles
  for (let i = 0; i < 240; i++) {
    const lum = 50 + Math.random() * 90;
    ctx.fillStyle = `rgba(${lum}, ${lum}, ${lum * 0.95 | 0}, ${0.18 + Math.random() * 0.22})`;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 2 + Math.random() * 5.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pits & pock marks
  for (let i = 0; i < 450; i++) {
    ctx.fillStyle = `rgba(18, 18, 22, ${0.35 + Math.random() * 0.5})`;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 0.5 + Math.random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hairline cracks — multi-segment quadratic beziers
  for (let i = 0; i < 18; i++) {
    ctx.strokeStyle = `rgba(16, 18, 22, ${0.35 + Math.random() * 0.45})`;
    ctx.lineWidth = 0.4 + Math.random() * 0.9;
    let x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segments = 5 + Math.floor(Math.random() * 9);
    for (let s = 0; s < segments; s++) {
      const dx = (Math.random() - 0.5) * 220;
      const dy = (Math.random() - 0.5) * 220;
      const cx = x + dx * 0.5 + (Math.random() - 0.5) * 60;
      const cy = y + dy * 0.5 + (Math.random() - 0.5) * 60;
      x += dx; y += dy;
      ctx.quadraticCurveTo(cx, cy, x, y);
    }
    ctx.stroke();
  }

  // Stain / oil blobs — soft radial fades
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 50 + Math.random() * 220;
    const oil = Math.random() < 0.45;
    const lum = oil ? 22 : 90;
    const alpha = 0.05 + Math.random() * 0.12;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${lum}, ${lum}, ${lum * 0.92 | 0}, ${alpha})`);
    g.addColorStop(0.6, `rgba(${lum}, ${lum}, ${lum * 0.92 | 0}, ${alpha * 0.4})`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Control joints (saw cuts) — straight thin dark lines every quarter-floor
  // with soft shadow rolloff so they read as recessed grooves under epoxy.
  const grid = size / 4;
  for (let i = 1; i < 4; i++) {
    const p = i * grid;
    // Cut itself
    ctx.fillStyle = '#13151a';
    ctx.fillRect(p - 1.5, 0, 3, size);
    ctx.fillRect(0, p - 1.5, size, 3);
    // Soft shadow band
    const gv = ctx.createLinearGradient(p - 10, 0, p + 10, 0);
    gv.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gv.addColorStop(0.5, 'rgba(0, 0, 0, 0.16)');
    gv.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gv;
    ctx.fillRect(p - 10, 0, 20, size);
    const gh = ctx.createLinearGradient(0, p - 10, 0, p + 10);
    gh.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gh.addColorStop(0.5, 'rgba(0, 0, 0, 0.16)');
    gh.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gh;
    ctx.fillRect(0, p - 10, size, 20);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.canvas = c;
  return tex;
}

// Roughness drops slightly in the bright vein areas — polished quartz is
// less rough than its matte pink matrix.
export function makeMarbleRoughnessFromColor(colorTex) {
  const src = colorTex.userData.canvas;
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d');
  const data = sctx.getImageData(0, 0, w, h).data;

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const lum = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;
    // Bright veins → 0.35 roughness; matte pink → 0.62 roughness
    const rough = 0.62 - lum * 0.27;
    const v = Math.max(0, Math.min(255, rough * 255)) | 0;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  octx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Procedural marble-tile color map. Dark Nero-Marquina-ish: charcoal base
// with soft pale veining and near-black grout.
export function makeTileColorTexture(size = 1024, tilesPerSide = 4) {
  const tile = size / tilesPerSide;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // Base — dark polished marble. Mid-gray reads under low light without
  // blowing out under AgX.
  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, '#383842');
  base.addColorStop(1, '#42424e');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Per-tile marble veining — pale gray-blue wisps on dark stone
  for (let ty = 0; ty < tilesPerSide; ty++) {
    for (let tx = 0; tx < tilesPerSide; tx++) {
      const ox = tx * tile, oy = ty * tile;

      // Slight tile-to-tile drift so they don't look stamped
      ctx.fillStyle = `rgba(${64 + Math.random() * 20 | 0}, ${68 + Math.random() * 20 | 0}, ${78 + Math.random() * 22 | 0}, 0.45)`;
      ctx.fillRect(ox + 4, oy + 4, tile - 8, tile - 8);

      // Wispy pale veins
      const veinCount = 5 + Math.floor(Math.random() * 3);
      for (let i = 0; i < veinCount; i++) {
        ctx.strokeStyle = `rgba(${200 + Math.random() * 40 | 0}, ${200 + Math.random() * 30 | 0}, ${215 + Math.random() * 30 | 0}, ${0.08 + Math.random() * 0.10})`;
        ctx.lineWidth = 0.8 + Math.random() * 1.4;
        ctx.beginPath();
        ctx.moveTo(ox + Math.random() * tile, oy + Math.random() * tile);
        ctx.bezierCurveTo(
          ox + Math.random() * tile, oy + Math.random() * tile,
          ox + Math.random() * tile, oy + Math.random() * tile,
          ox + Math.random() * tile, oy + Math.random() * tile
        );
        ctx.stroke();
      }
    }
  }

  // Grout — soft gradient bands instead of crisp rectangles. The fade
  // at each edge bakes anti-aliasing into the texture itself, so the
  // grout doesn't stairstep when the floor is foreshortened at near-
  // parallel viewing angles (where anisotropic filtering alone can't
  // fully compensate for hard pixel transitions in the source).
  drawSoftBands(ctx, size, tilesPerSide, tile, '#08080c', 5, 4);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Procedural tile normal map. Mostly flat; bevels around the grout lines so
// the grout reads as a recessed seam under any lighting angle.
export function makeTileNormalTexture(size = 1024, tilesPerSide = 4) {
  const tile = size / tilesPerSide;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // Flat (RGB = 128,128,255 -> normal pointing straight up)
  ctx.fillStyle = '#8080ff';
  ctx.fillRect(0, 0, size, size);

  // Bevel band around each grout line: 8px wide, ramping out then back
  const bevelW = 8;
  const drawBevelV = (cx, dir) => {
    // dir = +1 means the tile edge is to the right of cx (normal points -X near edge)
    for (let b = 0; b < bevelW; b++) {
      const t = b / bevelW; // 0 at outermost, 1 at grout
      // R encodes X component: 0=full -X, 255=full +X, 128=zero
      const r = Math.round(128 + dir * (1 - t) * 100);
      ctx.fillStyle = `rgb(${r}, 128, 255)`;
      const x = dir > 0 ? cx - 1 - b : cx + b;
      ctx.fillRect(x, 0, 1, size);
    }
  };
  const drawBevelH = (cy, dir) => {
    for (let b = 0; b < bevelW; b++) {
      const t = b / bevelW;
      const g = Math.round(128 + dir * (1 - t) * 100);
      ctx.fillStyle = `rgb(128, ${g}, 255)`;
      const y = dir > 0 ? cy - 1 - b : cy + b;
      ctx.fillRect(0, y, size, 1);
    }
  };

  for (let i = 1; i < tilesPerSide; i++) {
    const p = i * tile;
    drawBevelV(p, +1); // left side of grout: surface drops to the right
    drawBevelV(p, -1); // right side
    drawBevelH(p, +1);
    drawBevelH(p, -1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Procedural roughness map: tile faces polished, grout matte.
export function makeTileRoughnessTexture(size = 1024, tilesPerSide = 4) {
  const tile = size / tilesPerSide;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // Polished tile face = dark value = low roughness (sharp reflections)
  ctx.fillStyle = '#1c1c1e';
  ctx.fillRect(0, 0, size, size);

  // Grout = bright value = high roughness (matte). Soft edges so the
  // roughness transition matches the color map's softened grout and
  // doesn't show its own aliased band under specular highlights.
  drawSoftBands(ctx, size, tilesPerSide, tile, '#d8d8d8', 5, 4);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
