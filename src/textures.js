import * as THREE from 'three';

// Equirectangular environment map painted to look like a warehouse ceiling:
// dim warm walls, a row of bright fluorescent strips overhead, dark below.
// Fed through PMREMGenerator → scene.environment so the polished concrete
// floor and other PBR surfaces always have a credible reflection target
// regardless of whether the ceiling geometry is in the camera frustum.
export function makeWarehouseEnvironment(width = 2048, height = 1024) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');

  // Vertical gradient: dark at the poles, warm dim in the middle band
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0,    '#1a1816');  // top pole — dark ceiling void
  bg.addColorStop(0.35, '#403830');  // upper hemisphere — warm dim
  bg.addColorStop(0.55, '#322b24');  // horizon-ish — slightly dimmer
  bg.addColorStop(0.85, '#1a1614');  // lower hemisphere — darker
  bg.addColorStop(1,    '#080706');  // bottom pole — floor shadow
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Bright fluorescent strips — horizontal bands in the upper portion.
  // Multiple bands at slightly different heights for the row-of-fixtures
  // look that defines the reference image.
  const stripCount = 4;
  for (let i = 0; i < stripCount; i++) {
    const yCenter = height * (0.18 + i * 0.05);
    const halfH = height * 0.014;
    const g = ctx.createLinearGradient(0, yCenter - halfH * 1.8, 0, yCenter + halfH * 1.8);
    g.addColorStop(0,   'rgba(255, 248, 230, 0)');
    g.addColorStop(0.5, 'rgba(255, 252, 240, 1)');
    g.addColorStop(1,   'rgba(255, 248, 230, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, yCenter - halfH * 1.8, width, halfH * 3.6);
  }

  // Slight warm glow around the bright strips for soft halo
  const halo = ctx.createLinearGradient(0, height * 0.12, 0, height * 0.42);
  halo.addColorStop(0,   'rgba(255, 230, 200, 0)');
  halo.addColorStop(0.5, 'rgba(255, 230, 200, 0.10)');
  halo.addColorStop(1,   'rgba(255, 230, 200, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, height * 0.12, width, height * 0.30);

  return c;
}

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

// Heightmap from color luminance — fed into MeshPhysicalMaterial's
// displacementMap so dark areas (pits, cracks, missing chunks) physically
// recess into the geometry. Contrast curve (pow > 1) deepens the darks
// so the marring reads geometrically, not just as paint.
export function makeDisplacementFromColor(colorTex, contrast = 1.6) {
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
    const v = Math.max(0, Math.min(1, Math.pow(lum, contrast)));
    const px = (v * 255) | 0;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = px;
    img.data[o + 3] = 255;
  }
  octx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
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

  // Base — warm cream/tan polished concrete (Costco-floor reference).
  // Slow gradient breaks up flatness without showing as a hot spot.
  const base = ctx.createRadialGradient(
    size * 0.35, size * 0.45, size * 0.05,
    size * 0.55, size * 0.55, size * 0.78,
  );
  base.addColorStop(0, '#b4a890');
  base.addColorStop(0.5, '#a89c84');
  base.addColorStop(1, '#988c76');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Warm patches only — real cured concrete varies in cream/tan, no cool
  // splotches. Subtler than before.
  for (let i = 0; i < 24; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 200 + Math.random() * 480;
    const hue = 28 + Math.random() * 18;       // narrow warm range
    const sat = 8 + Math.random() * 10;
    const light = 48 + Math.random() * 15;
    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, ${0.05 + Math.random() * 0.07})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fine aggregate — dense, warm tan/cream flecks with a few darker grains
  for (let i = 0; i < 11000; i++) {
    const warm = Math.random() < 0.75;
    const lum = warm ? 180 + Math.random() * 55 : 90 + Math.random() * 40;
    const r = lum, g = (lum * 0.96) | 0, b = (lum * 0.88) | 0;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.10 + Math.random() * 0.18})`;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 0.4 + Math.random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Larger pebbles — small tan/dark inclusions
  for (let i = 0; i < 320; i++) {
    const warm = Math.random() < 0.6;
    const lum = warm ? 165 + Math.random() * 60 : 80 + Math.random() * 50;
    const r = lum, g = (lum * 0.95) | 0, b = (lum * 0.86) | 0;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.22 + Math.random() * 0.24})`;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 1.5 + Math.random() * 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hairline cracks — sparse, very subtle, warm-dark color
  for (let i = 0; i < 10; i++) {
    ctx.strokeStyle = `rgba(80, 70, 55, ${0.20 + Math.random() * 0.25})`;
    ctx.lineWidth = 0.4 + Math.random() * 0.8;
    let x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segments = 5 + Math.floor(Math.random() * 7);
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

  // ---- Crackle network — the reference's defining feature -------------
  // Random nodes connected to nearest neighbours forms a dried-mud /
  // surface-weathering crackle pattern. Same dark warm color so it reads
  // through any clearcoat as discoloration baked into the concrete.
  const crackleNodes = [];
  const nodeCount = 90;
  for (let i = 0; i < nodeCount; i++) {
    crackleNodes.push({ x: Math.random() * size, y: Math.random() * size });
  }
  ctx.strokeStyle = 'rgba(48, 40, 30, 0.55)';
  ctx.lineWidth = 0.8;
  for (const node of crackleNodes) {
    // Connect each node to its 2-3 nearest neighbors
    const dists = crackleNodes
      .map(n => ({ n, d: Math.hypot(n.x - node.x, n.y - node.y) }))
      .sort((a, b) => a.d - b.d);
    const connections = 2 + Math.floor(Math.random() * 2);
    for (let i = 1; i <= connections && i < dists.length; i++) {
      ctx.beginPath();
      // Slight wobble so cracks aren't perfectly straight
      const target = dists[i].n;
      const midX = (node.x + target.x) / 2 + (Math.random() - 0.5) * 8;
      const midY = (node.y + target.y) / 2 + (Math.random() - 0.5) * 8;
      ctx.moveTo(node.x, node.y);
      ctx.quadraticCurveTo(midX, midY, target.x, target.y);
      ctx.stroke();
    }
  }

  // ---- Pits ------------------------------------------------------------
  // Small irregular dark blobs scattered throughout — surface erosion
  // and impact divots. Darker than the matrix.
  for (let i = 0; i < 380; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 2 + Math.random() * 7;
    // Slightly irregular outline (not perfect circle) by drawing several
    // overlapping smaller blobs
    const blobCount = 3 + Math.floor(Math.random() * 4);
    for (let b = 0; b < blobCount; b++) {
      const ox = x + (Math.random() - 0.5) * r;
      const oy = y + (Math.random() - 0.5) * r;
      const br = r * (0.4 + Math.random() * 0.5);
      ctx.fillStyle = `rgba(38, 32, 24, ${0.45 + Math.random() * 0.35})`;
      ctx.beginPath();
      ctx.arc(ox, oy, br, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- Missing chunks --------------------------------------------------
  // Bigger irregular dark patches — places where material has worn or
  // chipped away. Vertex displacement will recess these into the geometry.
  for (let i = 0; i < 45; i++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const baseR = 8 + Math.random() * 28;
    // Irregular polygon outline
    const points = 8 + Math.floor(Math.random() * 6);
    const verts = [];
    for (let p = 0; p < points; p++) {
      const a = (p / points) * Math.PI * 2;
      const r = baseR * (0.5 + Math.random() * 0.7);
      verts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    // Soft dark gradient fill (darker at center, fades at edge)
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR);
    g.addColorStop(0, 'rgba(28, 24, 18, 0.72)');
    g.addColorStop(0.6, 'rgba(40, 34, 26, 0.50)');
    g.addColorStop(1, 'rgba(60, 50, 38, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let p = 0; p < verts.length; p++) {
      if (p === 0) ctx.moveTo(verts[p][0], verts[p][1]);
      else ctx.lineTo(verts[p][0], verts[p][1]);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Control joints (saw cuts) — clean horizontal lines, lighter than before
  // since polished cured concrete grout reads warm-tan not black.
  const grid = size / 4;
  for (let i = 1; i < 4; i++) {
    const p = i * grid;
    // Cut itself
    ctx.fillStyle = '#3c352a';
    ctx.fillRect(p - 1, 0, 2, size);
    ctx.fillRect(0, p - 1, size, 2);
    // Soft shadow band — much subtler
    const gv = ctx.createLinearGradient(p - 6, 0, p + 6, 0);
    gv.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gv.addColorStop(0.5, 'rgba(0, 0, 0, 0.08)');
    gv.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gv;
    ctx.fillRect(p - 6, 0, 12, size);
    const gh = ctx.createLinearGradient(0, p - 6, 0, p + 6);
    gh.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gh.addColorStop(0.5, 'rgba(0, 0, 0, 0.08)');
    gh.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gh;
    ctx.fillRect(0, p - 6, size, 12);
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
