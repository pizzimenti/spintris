// Runtime diagnostics — gated behind ?debug=1 so they don't spam a normal play
// session. Surfaces GPU capabilities, material/texture configuration, and
// per-frame stats so it's obvious when something falls off the fast path
// (anisotropy=1 instead of 16, generateMipmaps=false on a tiled texture,
// shaders failing to compile, etc.).
//
// Enable with: http://localhost:8765/?debug=1
// Also exposes window.__diag for ad-hoc poking from the devtools console.

const debugFlag = new URLSearchParams(location.search).get('debug') === '1';

function tag(s) { return `%c[spintris]%c ${s}`; }
const styleTag = 'color:#ff96a0;font-weight:600';
const styleMsg = 'color:inherit';

export const log = {
  info(msg, data) {
    console.log(tag(msg), styleTag, styleMsg, data ?? '');
  },
  warn(msg, data) {
    console.warn(tag(msg), styleTag, styleMsg, data ?? '');
  },
  error(msg, data) {
    console.error(tag(msg), styleTag, styleMsg, data ?? '');
  },
  group(label, fn) {
    console.groupCollapsed(tag(label), styleTag, styleMsg);
    try { fn(); } finally { console.groupEnd(); }
  },
};

// Capture every THREE warning/error so they appear under the spintris label
// alongside our own messages — easier to scan than mixed-source console output.
const origWarn = console.warn;
const origError = console.error;
console.warn = function (...args) {
  if (typeof args[0] === 'string' && args[0].startsWith('THREE.')) {
    origWarn.call(this, tag('THREE warn: ' + args[0]), styleTag, styleMsg, ...args.slice(1));
    return;
  }
  return origWarn.apply(this, args);
};
console.error = function (...args) {
  if (typeof args[0] === 'string' && args[0].startsWith('THREE.')) {
    origError.call(this, tag('THREE error: ' + args[0]), styleTag, styleMsg, ...args.slice(1));
    return;
  }
  return origError.apply(this, args);
};

export function reportRenderer(renderer) {
  const backend = renderer.backend?.isWebGPUBackend ? 'WEBGPU' : 'WEBGL2';
  const gl = renderer.getContext?.();
  const caps = renderer.capabilities ?? {};

  const info = {
    backend,
    pixelRatio: renderer.getPixelRatio?.(),
    toneMapping: toneMappingName(renderer.toneMapping),
    toneMappingExposure: renderer.toneMappingExposure,
    outputColorSpace: renderer.outputColorSpace,
    shadowMap: {
      enabled: renderer.shadowMap?.enabled,
      type: shadowMapTypeName(renderer.shadowMap?.type),
    },
    msaaSamples: renderer.samples ?? renderer._samples ?? 'unknown',
  };

  if (gl) {
    info.gl = {
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxCubeMapTextureSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxTextureUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
      maxSamples: gl.getParameter(gl.MAX_SAMPLES ?? 0x8d57),
      maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS ?? 0x8cdf),
      maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS ?? 0x8824),
      maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
      maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    };

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      info.gl.unmaskedVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
      info.gl.unmaskedRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    }

    const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
    info.gl.maxAnisotropy = anisoExt
      ? gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT)
      : 'no ext';

    info.gl.extensions = gl.getSupportedExtensions();
  }

  log.group(`renderer · ${backend} · ${info.gl?.unmaskedRenderer ?? '?'}`, () => {
    console.table([{
      backend: info.backend,
      pixelRatio: info.pixelRatio,
      msaa: info.msaaSamples,
      toneMapping: info.toneMapping,
      exposure: info.toneMappingExposure,
      shadows: `${info.shadowMap.enabled} (${info.shadowMap.type})`,
    }]);
    if (info.gl) {
      console.table([{
        vendor: info.gl.unmaskedVendor ?? info.gl.vendor,
        renderer: info.gl.unmaskedRenderer ?? info.gl.renderer,
        glVersion: info.gl.version,
        glsl: info.gl.shadingLanguageVersion,
        maxAniso: info.gl.maxAnisotropy,
        maxTex: info.gl.maxTextureSize,
        maxSamples: info.gl.maxSamples,
        maxDrawBuffers: info.gl.maxDrawBuffers,
      }]);
      log.info('WebGL extensions:', info.gl.extensions);
    }
  });

  return info;
}

export function reportScene(scene) {
  let meshes = 0, lights = 0, triangles = 0;
  const materials = new Set();
  const textures = new Set();
  scene.traverse(o => {
    if (o.isMesh) {
      meshes++;
      if (o.geometry?.index) triangles += o.geometry.index.count / 3;
      else if (o.geometry?.attributes?.position) triangles += o.geometry.attributes.position.count / 3;
      if (o.material) materials.add(o.material);
    } else if (o.isLight) {
      lights++;
    }
  });
  for (const m of materials) {
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
      if (m[key]) textures.add(m[key]);
    }
  }

  log.group(`scene · ${meshes} meshes · ${lights} lights · ${Math.round(triangles)} tris`, () => {
    log.info('materials:', materials.size);
    log.info('textures:', textures.size);
    // Audit each texture for the fast-path settings — anisotropy max, mipmaps on, correct filters.
    const rows = [];
    for (const t of textures) {
      rows.push({
        uuid: t.uuid.slice(0, 8),
        type: t.constructor?.name ?? 'Texture',
        size: t.image ? `${t.image.width ?? t.image.naturalWidth}×${t.image.height ?? t.image.naturalHeight}` : '?',
        anisotropy: t.anisotropy,
        generateMipmaps: t.generateMipmaps,
        minFilter: filterName(t.minFilter),
        magFilter: filterName(t.magFilter),
        wrap: `${wrapName(t.wrapS)}/${wrapName(t.wrapT)}`,
        colorSpace: t.colorSpace,
      });
    }
    console.table(rows);
  });
}

export function startFrameMonitor(renderer) {
  if (!debugFlag) return;
  // Frame-time HUD in the corner, updated once a second from a rolling buffer.
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:8px 12px;background:rgba(10,12,20,0.65);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.08);border-radius:10px;font:11px ui-monospace,Menlo,Consolas,monospace;line-height:1.6;color:#cfd2dc;letter-spacing:0.4px;pointer-events:none;z-index:8;';
  document.body.appendChild(el);

  const samples = [];
  const SIZE = 60;
  let last = performance.now();
  let acc = 0;

  function tick() {
    const now = performance.now();
    const dt = now - last;
    last = now;
    samples.push(dt);
    if (samples.length > SIZE) samples.shift();
    acc += dt;

    if (acc > 500) {
      acc = 0;
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const info = renderer.info;
      el.innerHTML = `
        <div>${(1000 / median).toFixed(0)} fps · ${median.toFixed(1)}ms · p95 ${p95.toFixed(1)}ms</div>
        <div>calls: ${info?.render?.calls ?? '?'} · tris: ${info?.render?.triangles ?? '?'}</div>
        <div>geos: ${info?.memory?.geometries ?? '?'} · tex: ${info?.memory?.textures ?? '?'}</div>
      `.trim();
    }
    requestAnimationFrame(tick);
  }
  tick();
}

function toneMappingName(v) {
  // THREE constants — keep this minimal, just the ones we might use.
  return ({ 0: 'None', 1: 'Linear', 2: 'Reinhard', 3: 'Cineon', 4: 'ACESFilmic', 5: 'Custom', 6: 'AgX', 7: 'Neutral' })[v] ?? `?(${v})`;
}
function shadowMapTypeName(v) {
  return ({ 0: 'Basic', 1: 'PCF', 2: 'PCFSoft', 3: 'VSM' })[v] ?? `?(${v})`;
}
function filterName(v) {
  return ({ 9728: 'Nearest', 9729: 'Linear', 9984: 'NearestMipmapNearest', 9985: 'LinearMipmapNearest', 9986: 'NearestMipmapLinear', 9987: 'LinearMipmapLinear' })[v] ?? `?(${v})`;
}
function wrapName(v) {
  return ({ 1000: 'Repeat', 1001: 'ClampToEdge', 1002: 'MirroredRepeat' })[v] ?? `?(${v})`;
}

export const isDebug = debugFlag;
