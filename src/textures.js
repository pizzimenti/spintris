import * as THREE from 'three';

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

  // Grout — very dark, wide, high contrast against the tile face
  ctx.fillStyle = '#08080c';
  const grout = 6;
  for (let i = 0; i <= tilesPerSide; i++) {
    const p = i * tile;
    ctx.fillRect(p - grout / 2, 0, grout, size);
    ctx.fillRect(0, p - grout / 2, size, grout);
  }

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

  // Grout = bright value = high roughness (matte)
  ctx.fillStyle = '#d8d8d8';
  const grout = 6;
  for (let i = 0; i <= tilesPerSide; i++) {
    const p = i * tile;
    ctx.fillRect(p - grout / 2, 0, grout, size);
    ctx.fillRect(0, p - grout / 2, size, grout);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
