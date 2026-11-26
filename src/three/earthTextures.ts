import * as THREE from 'three';
import {
  ABYSSAL_TRENCHES,
  CITY_LIGHT_CLUSTERS,
  CONTINENT_POLYGONS,
  CORAL_REEF_ATOLLS,
  DESERT_ZONES,
  LUSH_BIOME_ZONES,
  MAJOR_LAKES,
  MAJOR_RIVERS,
  MOUNTAIN_RANGES,
  TECTONIC_BOUNDARIES,
  URBAN_HIGHWAY_CORRIDORS,
  type LonLat,
} from './worldGeography';
import {
  buildModeledWeatherSnapshot,
  type WeatherSample,
} from '../services/weatherTelemetry';

export interface EarthTextureBundle {
  dayMap: THREE.CanvasTexture;
  nightMap: THREE.CanvasTexture;
  /** Packed PBR utility map: R = valley AO, G = roughness, B = open water mask */
  roughnessMap: THREE.CanvasTexture;
  /** True tangent-space RGB normal map computed from continuous elevation heightfield */
  normalMap: THREE.CanvasTexture;
  /** Primary lower cyclonic / trade-wind cloud layer */
  cloudMap: THREE.CanvasTexture;
  /** Secondary high-altitude wispy cirrus layer */
  cirrusMap: THREE.CanvasTexture;
  precipitationMap: THREE.CanvasTexture;
  thermalMap: THREE.CanvasTexture;
  co2Map: THREE.CanvasTexture;
  tectonicMap: THREE.CanvasTexture;
  resolutionLabel: '4K' | '2K';
  updateWeatherTextures: (samples: WeatherSample[]) => void;
  dispose: () => void;
}

// Fast deterministic 3D hash & value noise (seamless across the sphere, zero seam at ±180°)
function hash3(ix: number, iy: number, iz: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1274126177);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function hash2(ix: number, iy: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const n000 = hash3(ix, iy, iz);
  const n100 = hash3(ix + 1, iy, iz);
  const n010 = hash3(ix, iy + 1, iz);
  const n110 = hash3(ix + 1, iy + 1, iz);
  const n001 = hash3(ix, iy, iz + 1);
  const n101 = hash3(ix + 1, iy, iz + 1);
  const n011 = hash3(ix, iy + 1, iz + 1);
  const n111 = hash3(ix + 1, iy + 1, iz + 1);

  const nx00 = n000 + (n100 - n000) * ux;
  const nx10 = n010 + (n110 - n010) * ux;
  const nx01 = n001 + (n101 - n001) * ux;
  const nx11 = n011 + (n111 - n011) * ux;

  const nxy0 = nx00 + (nx10 - nx00) * uy;
  const nxy1 = nx01 + (nx11 - nx01) * uy;
  return nxy0 + (nxy1 - nxy0) * uz;
}

function fbm3(x: number, y: number, z: number, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += amp * noise3(x * freq, y * freq, z * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return value;
}

function ridgedFbm3(x: number, y: number, z: number, octaves = 4): number {
  let value = 0;
  let amp = 0.55;
  let freq = 1;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise3(x * freq, y * freq, z * freq) * 2 - 1);
    const sq = n * n * weight;
    weight = Math.min(1, Math.max(0.2, sq * 1.6));
    value += sq * amp;
    freq *= 2.12;
    amp *= 0.5;
  }
  return value;
}

function lonToX(lon: number, width: number): number {
  return ((lon + 180) / 360) * width;
}

function latToY(lat: number, height: number): number {
  return ((90 - lat) / 180) * height;
}

function drawPolygonList(
  ctx: CanvasRenderingContext2D,
  polygons: LonLat[][],
  width: number,
  height: number,
  fillStyle: string,
) {
  ctx.fillStyle = fillStyle;
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    ctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      const px = lonToX(poly[i][0], width);
      const py = latToY(poly[i][1], height);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function strokePolygonList(
  ctx: CanvasRenderingContext2D,
  polygons: LonLat[][],
  width: number,
  height: number,
  strokeStyle: string,
  lineWidth: number,
) {
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    ctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      const px = lonToX(poly[i][0], width);
      const py = latToY(poly[i][1], height);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

function strokePolylineList(
  ctx: CanvasRenderingContext2D,
  polylines: LonLat[][],
  width: number,
  height: number,
  strokeStyle: string,
  lineWidth: number,
) {
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const line of polylines) {
    if (line.length < 2) continue;
    ctx.beginPath();
    for (let i = 0; i < line.length; i++) {
      const px = lonToX(line[i][0], width);
      const py = latToY(line[i][1], height);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function sampleRamp(
  stops: [number, number, number, number][],
  t: number,
): [number, number, number] {
  const x = clamp01(t);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (x >= a[0] && x <= b[0]) {
      const f = (x - a[0]) / Math.max(1e-5, b[0] - a[0]);
      return [lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

const THERMAL_STOPS: [number, number, number, number][] = [
  [0.0, 20, 48, 160],
  [0.25, 14, 154, 212],
  [0.5, 34, 197, 128],
  [0.75, 245, 158, 11],
  [1.0, 225, 52, 42],
];

const CO2_STOPS: [number, number, number, number][] = [
  [0.0, 14, 24, 46],
  [0.3, 14, 116, 144],
  [0.55, 20, 184, 166],
  [0.8, 234, 179, 8],
  [1.0, 249, 115, 22],
];

const PRECIP_RADAR_STOPS: [number, number, number, number][] = [
  [0.0, 14, 165, 233],
  [0.24, 6, 182, 212],
  [0.48, 34, 197, 94],
  [0.72, 245, 158, 11],
  [0.9, 239, 68, 68],
  [1.0, 219, 39, 119],
];

function sampleFieldBilinear(
  field: Float32Array,
  fw: number,
  fh: number,
  u: number,
  v: number,
): number {
  const fx = u * fw - 0.5;
  const fy = clamp01(v) * (fh - 1);
  const x0 = ((Math.floor(fx) % fw) + fw) % fw;
  const x1 = (x0 + 1) % fw;
  const y0 = Math.max(0, Math.min(fh - 1, Math.floor(fy)));
  const y1 = Math.min(fh - 1, y0 + 1);
  const tx = fx - Math.floor(fx);
  const ty = fy - y0;
  const v00 = field[y0 * fw + x0];
  const v10 = field[y0 * fw + x1];
  const v01 = field[y1 * fw + x0];
  const v11 = field[y1 * fw + x1];
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
}

export function createEarthTextures(
  maxAnisotropy: number,
  prefer4K = true,
): EarthTextureBundle {
  // Adaptive 4K (4096x2048) on hardware GPUs, automatic 2K (2048x1024) fallback for low-VRAM / software WebGL
  const deviceMem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const use4K = prefer4K && (deviceMem === undefined || deviceMem >= 4);
  const W = use4K ? 4096 : 2048;
  const H = use4K ? 2048 : 1024;
  const OW = 1024;
  const OH = 512;
  const CW = use4K ? 2048 : 1024;
  const CH = use4K ? 1024 : 512;
  const resScale = W / 2048;

  // 1. Rasterize high-precision 4K/2K continental mask
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const maskCtx = maskCanvas.getContext('2d')!;
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, W, H);
  drawPolygonList(maskCtx, CONTINENT_POLYGONS, W, H, '#ffffff');
  drawPolygonList(maskCtx, MAJOR_LAKES, W, H, '#000000');
  const sharpMaskData = maskCtx.getImageData(0, 0, W, H).data;

  // Rasterize river drainage & delta mask onto a full-res canvas (R = river channel, G = lush alluvial delta)
  const riverCanvas = document.createElement('canvas');
  riverCanvas.width = W;
  riverCanvas.height = H;
  const riverCtx = riverCanvas.getContext('2d')!;
  riverCtx.fillStyle = '#000000';
  riverCtx.fillRect(0, 0, W, H);
  // Broad verdant floodplain halo in green channel
  strokePolylineList(riverCtx, MAJOR_RIVERS, W, H, 'rgba(0, 210, 0, 0.34)', 7.5 * resScale);
  strokePolylineList(riverCtx, MAJOR_RIVERS, W, H, 'rgba(0, 255, 0, 0.52)', 3.6 * resScale);
  // Crisp river channels in red channel
  strokePolylineList(riverCtx, MAJOR_RIVERS, W, H, 'rgba(255, 160, 0, 0.92)', 1.35 * resScale);
  // Coastal delta fans at river mouths
  for (const river of MAJOR_RIVERS) {
    if (river.length < 2) continue;
    const mouth = river[river.length - 1];
    const mx = lonToX(mouth[0], W);
    const my = latToY(mouth[1], H);
    const deltaR = 8.5 * resScale;
    const dg = riverCtx.createRadialGradient(mx, my, 0, mx, my, deltaR);
    dg.addColorStop(0, 'rgba(180, 255, 255, 0.72)');
    dg.addColorStop(0.55, 'rgba(40, 220, 180, 0.34)');
    dg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    riverCtx.fillStyle = dg;
    riverCtx.beginPath();
    riverCtx.arc(mx, my, deltaR, 0, Math.PI * 2);
    riverCtx.fill();
  }
  const riverData = riverCtx.getImageData(0, 0, W, H).data;

  // Rasterize ocean bathymetry features: coral shelves (G), mid-ocean ridges (R), abyssal trenches (B)
  const bathyCanvas = document.createElement('canvas');
  bathyCanvas.width = W;
  bathyCanvas.height = H;
  const bathyCtx = bathyCanvas.getContext('2d')!;
  bathyCtx.fillStyle = '#000000';
  bathyCtx.fillRect(0, 0, W, H);

  // Mid-ocean spreading ridges along tectonic boundaries
  bathyCtx.globalCompositeOperation = 'lighter';
  strokePolylineList(
    bathyCtx,
    TECTONIC_BOUNDARIES,
    W,
    H,
    'rgba(145, 0, 0, 0.42)',
    18 * resScale,
  );
  strokePolylineList(
    bathyCtx,
    TECTONIC_BOUNDARIES,
    W,
    H,
    'rgba(220, 0, 0, 0.65)',
    5.5 * resScale,
  );
  // Deep abyssal trenches
  strokePolylineList(
    bathyCtx,
    ABYSSAL_TRENCHES,
    W,
    H,
    'rgba(0, 0, 190, 0.58)',
    14 * resScale,
  );
  strokePolylineList(
    bathyCtx,
    ABYSSAL_TRENCHES,
    W,
    H,
    'rgba(0, 0, 255, 0.92)',
    4.2 * resScale,
  );
  // Turquoise coral reef atolls & shallow tropical banks
  for (const [clon, clat, degR] of CORAL_REEF_ATOLLS) {
    const cx = lonToX(clon, W);
    const cy = latToY(clat, H);
    const radPx = (degR / 360) * W;
    const cg = bathyCtx.createRadialGradient(cx, cy, 0, cx, cy, radPx);
    cg.addColorStop(0, 'rgba(0, 255, 0, 0.92)');
    cg.addColorStop(0.55, 'rgba(0, 210, 0, 0.45)');
    cg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    bathyCtx.fillStyle = cg;
    bathyCtx.beginPath();
    bathyCtx.arc(cx, cy, radPx, 0, Math.PI * 2);
    bathyCtx.fill();
  }
  bathyCtx.globalCompositeOperation = 'source-over';
  const bathyData = bathyCtx.getImageData(0, 0, W, H).data;

  // Two-stage continental shelf distance fields (computed at 1K then upscaled smoothly for speed + fidelity)
  const shelfSmallCanvas = document.createElement('canvas');
  shelfSmallCanvas.width = OW;
  shelfSmallCanvas.height = OH;
  const shelfSmallCtx = shelfSmallCanvas.getContext('2d')!;
  shelfSmallCtx.fillStyle = '#000000';
  shelfSmallCtx.fillRect(0, 0, OW, OH);
  shelfSmallCtx.filter = 'blur(4px)';
  shelfSmallCtx.drawImage(maskCanvas, 0, 0, OW, OH);
  shelfSmallCtx.filter = 'none';
  const shelfNearSmall = shelfSmallCtx.getImageData(0, 0, OW, OH).data;

  const slopeSmallCanvas = document.createElement('canvas');
  slopeSmallCanvas.width = OW;
  slopeSmallCanvas.height = OH;
  const slopeSmallCtx = slopeSmallCanvas.getContext('2d')!;
  slopeSmallCtx.fillStyle = '#000000';
  slopeSmallCtx.fillRect(0, 0, OW, OH);
  slopeSmallCtx.filter = 'blur(14px)';
  slopeSmallCtx.drawImage(maskCanvas, 0, 0, OW, OH);
  slopeSmallCtx.filter = 'none';
  const shelfWideSmall = slopeSmallCtx.getImageData(0, 0, OW, OH).data;

  const shelfNearField = new Float32Array(OW * OH);
  const shelfWideField = new Float32Array(OW * OH);
  for (let i = 0; i < OW * OH; i++) {
    shelfNearField[i] = shelfNearSmall[i * 4] / 255;
    shelfWideField[i] = shelfWideSmall[i * 4] / 255;
  }

  // 2. Precompute high-quality seamless 3D domain-warped fBm fields at 1024x512 (~40ms)
  const NW = 1024;
  const NH = 512;
  const warpedBiomeField = new Float32Array(NW * NH);
  const ridgeField = new Float32Array(NW * NH);
  const duneField = new Float32Array(NW * NH);
  const abyssalField = new Float32Array(NW * NH);
  const fjordField = new Float32Array(NW * NH);

  const nCosLon = new Float32Array(NW);
  const nSinLon = new Float32Array(NW);
  for (let x = 0; x < NW; x++) {
    const rad = (((x + 0.5) / NW) * 360 - 180) * (Math.PI / 180);
    nCosLon[x] = Math.cos(rad);
    nSinLon[x] = Math.sin(rad);
  }

  for (let y = 0; y < NH; y++) {
    const lat = 90 - ((y + 0.5) / NH) * 180;
    const latRad = (lat * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);
    for (let x = 0; x < NW; x++) {
      const sx = cosLat * nCosLon[x];
      const sy = sinLat;
      const sz = cosLat * nSinLon[x];
      const pIdx = y * NW + x;

      // Domain warp vector for organic continental biome transitions & wadi erosion
      const qx = fbm3(sx * 4.2 + 2.1, sy * 4.2 - 1.3, sz * 4.2 + 0.7, 3) - 0.5;
      const qy = fbm3(sx * 4.2 - 3.4, sy * 4.2 + 2.8, sz * 4.2 - 2.2, 3) - 0.5;
      const qz = fbm3(sx * 4.2 + 5.7, sy * 4.2 + 0.4, sz * 4.2 + 3.9, 3) - 0.5;

      warpedBiomeField[pIdx] = fbm3(
        (sx + qx * 0.36) * 12.0 + 7.2,
        (sy + qy * 0.36) * 12.0 + 1.4,
        (sz + qz * 0.36) * 12.0 - 4.8,
        4,
      );

      ridgeField[pIdx] = ridgedFbm3(
        (sx + qx * 0.18) * 16.5 - 2.1,
        (sy + qy * 0.18) * 16.5 + 4.3,
        (sz + qz * 0.18) * 16.5 + 1.7,
        4,
      );

      // Anisotropic wind-sculpted desert dune ridges & wadis
      duneField[pIdx] = fbm3(
        sx * 24.0 + qz * 2.2,
        sy * 54.0 + qx * 1.4,
        sz * 24.0 - qy * 2.2,
        3,
      );

      abyssalField[pIdx] = fbm3(sx * 8.5 - 2.2, sy * 8.5 + 4.1, sz * 8.5 + 1.1, 4);
      fjordField[pIdx] = ridgedFbm3(sx * 36.0 + 1.1, sy * 36.0 - 2.7, sz * 36.0 + 3.4, 3);
    }
  }

  // Precompute biome & elevation macro fields (Desert, Lush, Mountain) at 1024x512 for fast 4K bilinear lookup
  const desertMacro = new Float32Array(NW * NH);
  const lushMacro = new Float32Array(NW * NH);
  const mountainMacro = new Float32Array(NW * NH);
  for (let y = 0; y < NH; y++) {
    const lat = 90 - ((y + 0.5) / NH) * 180;
    for (let x = 0; x < NW; x++) {
      const lon = ((x + 0.5) / NW) * 360 - 180;
      const pIdx = y * NW + x;

      let desert = 0;
      for (let d = 0; d < DESERT_ZONES.length; d++) {
        const [dlon, dlat, rlon, rlat, intensity] = DESERT_ZONES[d];
        const dx = (lon - dlon) / rlon;
        const dy = (lat - dlat) / rlat;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 2.1) {
          desert = Math.max(desert, Math.exp(-dist2 * 1.45) * intensity);
        }
      }
      desertMacro[pIdx] = desert;

      let lush = 0;
      for (let l = 0; l < LUSH_BIOME_ZONES.length; l++) {
        const [llon, llat, rlon, rlat, strength] = LUSH_BIOME_ZONES[l];
        const dx = (lon - llon) / rlon;
        const dy = (lat - llat) / rlat;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 2.1) {
          lush = Math.max(lush, Math.exp(-dist2 * 1.38) * strength);
        }
      }
      lushMacro[pIdx] = lush;

      let mountain = 0;
      for (let m = 0; m < MOUNTAIN_RANGES.length; m++) {
        const [mlon, mlat, rlon, rlat, height] = MOUNTAIN_RANGES[m];
        const dx = (lon - mlon) / rlon;
        const dy = (lat - mlat) / rlat;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 2.2) {
          mountain = Math.max(mountain, Math.exp(-dist2 * 1.5) * height);
        }
      }
      mountainMacro[pIdx] = mountain;
    }
  }

  // Prepare output canvases
  const dayCanvas = document.createElement('canvas');
  dayCanvas.width = W;
  dayCanvas.height = H;
  const dayCtx = dayCanvas.getContext('2d')!;
  const dayImg = dayCtx.createImageData(W, H);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = W;
  roughCanvas.height = H;
  const roughCtx = roughCanvas.getContext('2d')!;
  const roughImg = roughCtx.createImageData(W, H);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = W;
  normalCanvas.height = H;
  const normalCtx = normalCanvas.getContext('2d')!;
  const normalImg = normalCtx.createImageData(W, H);

  // Continuous float elevation heightfield (0..1) used to synthesize the true tangent-space RGB normal map
  const elevationField = new Float32Array(W * H);
  const landMask = new Uint8Array(W * H);

  // 3. Synthesize 4K/2K Day Albedo, Packed Roughness/AO/WaterMask, and Elevation Field
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    const lat = 90 - v * 180;
    const absLat = Math.abs(lat);
    const highLatFjordMask = smoothstep(54, 68, absLat);
    const tropicFactor = smoothstep(26, 3, absLat);
    const borealFactor = smoothstep(47, 65, absLat);
    const steppeFactor = smoothstep(26, 44, absLat) * (1 - smoothstep(46, 62, absLat));

    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const lon = u * 360 - 180;
      const pIdx = y * W + x;
      const idx4 = pIdx * 4;

      const sharpVal = sharpMaskData[idx4] / 255;
      const riverChannel = riverData[idx4] / 255;
      const riverAlluvial = riverData[idx4 + 1] / 255;
      const deltaFan = riverData[idx4 + 2] / 255;

      const ridgeBathy = bathyData[idx4] / 255;
      const coralAtoll = bathyData[idx4 + 1] / 255;
      const trenchBathy = bathyData[idx4 + 2] / 255;

      const shallowVal = sampleFieldBilinear(shelfNearField, OW, OH, u, v);
      const slopeVal = sampleFieldBilinear(shelfWideField, OW, OH, u, v);
      const warpedNoise = sampleFieldBilinear(warpedBiomeField, NW, NH, u, v);
      const ridgeNoise = sampleFieldBilinear(ridgeField, NW, NH, u, v);
      const duneNoise = sampleFieldBilinear(duneField, NW, NH, u, v);
      const abyssalRelief = sampleFieldBilinear(abyssalField, NW, NH, u, v);
      const fjordNoise = sampleFieldBilinear(fjordField, NW, NH, u, v);

      // Fast multi-scale 4K micro-grain for crisp close-up texture without flat plastic patches
      const microA = hash2(x >> 1, y >> 1);
      const microB = hash2(x, y);
      const microGrain = (microA * 0.65 + microB * 0.35) - 0.5;

      // Carve subtle glacial fjords along high-latitude coastlines while preserving global accuracy
      const fjordCarve =
        highLatFjordMask > 0.05 && sharpVal > 0.08 && sharpVal < 0.96
          ? (fjordNoise - 0.52) * 0.24 * highLatFjordMask
          : 0;
      const microCoast =
        sharpVal > 0.02 && sharpVal < 0.98 ? microGrain * 0.14 + fjordCarve : 0;
      const landCov = clamp01(sharpVal + microCoast);
      const isLand = landCov >= 0.48;
      landMask[pIdx] = isLand ? 255 : 0;

      if (!isLand) {
        // Rich ocean bathymetry: deep abyssal trenches -> plains -> mid-ocean ridges -> turquoise shelves & coral atolls
        const shelfNear = smoothstep(0.05, 0.56, shallowVal);
        const shelfWide = smoothstep(0.03, 0.48, slopeVal);
        const coralBoost = clamp01(coralAtoll * (0.45 + shelfWide * 0.75));
        const polarSeaIce = smoothstep(75.5, 84.5, absLat + (warpedNoise - 0.5) * 5.2);

        // Abyssal base with subtle tectonic ridge lift and deep trench darkening
        let r =
          lerp(5, 11, shelfWide) +
          lerp(0, 22, shelfNear) +
          abyssalRelief * 6 +
          ridgeBathy * 7 -
          trenchBathy * 5;
        let g =
          lerp(18, 44, shelfWide) +
          lerp(0, 82, shelfNear) +
          abyssalRelief * 12 +
          ridgeBathy * 13 -
          trenchBathy * 12;
        let b =
          lerp(44, 86, shelfWide) +
          lerp(0, 74, shelfNear) +
          abyssalRelief * 17 +
          ridgeBathy * 18 -
          trenchBathy * 18;

        // Luminous turquoise tropical coral shelves & river sediment plumes
        if (coralBoost > 0.02) {
          r = lerp(r, 24, coralBoost * 0.62);
          g = lerp(g, 168, coralBoost * 0.68);
          b = lerp(b, 174, coralBoost * 0.65);
        }
        if (deltaFan > 0.04) {
          r = lerp(r, 42, deltaFan * 0.42);
          g = lerp(g, 128, deltaFan * 0.46);
          b = lerp(b, 124, deltaFan * 0.42);
        }

        // Polar sea ice sheets with subtle pressure-ridge grain
        if (polarSeaIce > 0.01) {
          const iceTone = 212 + microGrain * 18 + (warpedNoise - 0.5) * 14;
          r = lerp(r, iceTone, polarSeaIce * 0.88);
          g = lerp(g, iceTone + 14, polarSeaIce * 0.88);
          b = lerp(b, iceTone + 26, polarSeaIce * 0.88);
        }

        dayImg.data[idx4] = clamp01(r / 255) * 255;
        dayImg.data[idx4 + 1] = clamp01(g / 255) * 255;
        dayImg.data[idx4 + 2] = clamp01(b / 255) * 255;
        dayImg.data[idx4 + 3] = 255;

        // Packed utility channels: R = valleyAO (ocean neutral ~235), G = roughness, B = open water mask
        const waterMaskByte = Math.round((1 - smoothstep(0.15, 0.72, polarSeaIce)) * 255);
        const oceanRough = lerp(42, 146, polarSeaIce) + microGrain * 8;
        roughImg.data[idx4] = 238;
        roughImg.data[idx4 + 1] = clamp01(oceanRough / 255) * 255;
        roughImg.data[idx4 + 2] = waterMaskByte;
        roughImg.data[idx4 + 3] = 255;

        // Subtle underwater bathymetry elevation for gentle oceanic normal contour
        elevationField[pIdx] = clamp01(
          0.12 +
            abyssalRelief * 0.06 +
            shelfNear * 0.05 +
            ridgeBathy * 0.07 -
            trenchBathy * 0.09,
        );
      } else {
        // Domain-warped organic continental biomes
        const desertBase = sampleFieldBilinear(desertMacro, NW, NH, u, v);
        const lushBase = sampleFieldBilinear(lushMacro, NW, NH, u, v);
        const mountainBase = sampleFieldBilinear(mountainMacro, NW, NH, u, v);

        const lush = clamp01(
          lushBase + riverAlluvial * 0.58 + (warpedNoise - 0.5) * 0.16,
        );
        let desert = clamp01(
          desertBase + (warpedNoise - 0.5) * 0.24 + (duneNoise - 0.5) * 0.12,
        );
        // Lush river basins (e.g. Nile, Amazon, Ganges) carve vivid greenery through arid corridors
        desert = clamp01(desert * (1 - lush * 0.82));

        // Multi-scale mountain cordillera relief
        const elevation = clamp01(
          0.22 +
            warpedNoise * 0.16 +
            ridgeNoise * 0.12 +
            mountainBase * (0.38 + ridgeNoise * 0.44) +
            microGrain * 0.025 -
            riverChannel * 0.06,
        );

        const inGreenland = lon > -66 && lon < -17 && lat > 60.5;
        const iceFactor = clamp01(
          smoothstep(67.5, 77.5, absLat + (warpedNoise - 0.5) * 5.2) +
            (lat < -62.5 ? 0.96 : 0) +
            (inGreenland ? 0.9 * smoothstep(0.16, 0.68, shallowVal) : 0),
        );

        // Natural satellite biome palette: tropical canopy -> temperate forest/steppe -> boreal taiga/tundra
        let r = lerp(62, 22, tropicFactor);
        let g = lerp(94, 76, tropicFactor);
        let b = lerp(46, 34, tropicFactor);

        // Temperate golden-olive steppe variation
        const steppeMix = steppeFactor * smoothstep(0.38, 0.78, warpedNoise) * (1 - lush * 0.7);
        r = lerp(r, 114, steppeMix * 0.55);
        g = lerp(g, 112, steppeMix * 0.48);
        b = lerp(b, 68, steppeMix * 0.5);

        // Deep emerald rainforest & river delta canopy
        if (lush > 0.04) {
          r = lerp(r, 20, lush * 0.72);
          g = lerp(g, 72, lush * 0.72);
          b = lerp(b, 31, lush * 0.72);
        }

        // Boreal taiga & Arctic tundra
        r = lerp(r, 46, borealFactor * 0.82);
        g = lerp(g, 64, borealFactor * 0.82);
        b = lerp(b, 48, borealFactor * 0.82);
        const tundraMix = smoothstep(61, 71, absLat + (warpedNoise - 0.5) * 4.0);
        r = lerp(r, 98, tundraMix * 0.55);
        g = lerp(g, 96, tundraMix * 0.55);
        b = lerp(b, 80, tundraMix * 0.55);

        // Organic soil & canopy micro-variation
        const texMod = (warpedNoise - 0.5) * 32 + microGrain * 22;
        r += texMod;
        g += texMod * 1.04;
        b += texMod * 0.76;

        // Arid sandstone deserts with dune crests and eroded wadis
        if (desert > 0.06) {
          const dMix = smoothstep(0.08, 0.74, desert);
          const duneHighlight = (duneNoise - 0.5) * 34 + microGrain * 18;
          const wadiDarken = smoothstep(0.72, 0.94, ridgeNoise) * 26;
          r = lerp(r, 188 + duneHighlight - wadiDarken, dMix);
          g = lerp(g, 152 + duneHighlight * 0.85 - wadiDarken * 0.88, dMix);
          b = lerp(b, 102 + duneHighlight * 0.62 - wadiDarken * 0.7, dMix);
        }

        // Alpine rock strata and snow-capped cordilleras
        if (elevation > 0.49) {
          const rockMix = smoothstep(0.49, 0.7, elevation);
          const rockVar = (ridgeNoise - 0.5) * 28 + microGrain * 20;
          r = lerp(r, 106 + rockVar, rockMix);
          g = lerp(g, 99 + rockVar * 0.94, rockMix);
          b = lerp(b, 92 + rockVar * 0.88, rockMix);

          const peakSnow = smoothstep(0.71, 0.87, elevation + (absLat > 32 ? 0.04 : 0));
          r = lerp(r, 232, peakSnow);
          g = lerp(g, 239, peakSnow);
          b = lerp(b, 246, peakSnow);
        }

        // Crisp river drainage channels cutting across continents
        let isRiverWater = 0;
        if (riverChannel > 0.36 && iceFactor < 0.45 && elevation < 0.62) {
          const rMix = smoothstep(0.36, 0.85, riverChannel) * 0.82;
          r = lerp(r, 18, rMix);
          g = lerp(g, 62, rMix);
          b = lerp(b, 96, rMix);
          isRiverWater = rMix * 0.7;
        }

        // Polar ice sheets (Antarctica, Greenland interior, high Arctic)
        if (iceFactor > 0.02) {
          const iMix = smoothstep(0.05, 0.82, iceFactor);
          const iceMod = (warpedNoise - 0.5) * 18 + microGrain * 12;
          r = lerp(r, 220 + iceMod, iMix);
          g = lerp(g, 231 + iceMod * 0.92, iMix);
          b = lerp(b, 243 + iceMod * 0.75, iMix);
        }

        dayImg.data[idx4] = clamp01(r / 255) * 255;
        dayImg.data[idx4 + 1] = clamp01(g / 255) * 255;
        dayImg.data[idx4 + 2] = clamp01(b / 255) * 255;
        dayImg.data[idx4 + 3] = 255;

        // Valley ambient occlusion: deepen crevices between mountain ridges
        const valleyAo = clamp01(
          1.0 - mountainBase * (1.0 - ridgeNoise) * 0.46 - (1.0 - warpedNoise) * 0.08,
        );
        const landRough = lerp(228, 150, iceFactor) - elevation * 20 - isRiverWater * 130;
        roughImg.data[idx4] = Math.round(valleyAo * 255);
        roughImg.data[idx4 + 1] = clamp01(landRough / 255) * 255;
        roughImg.data[idx4 + 2] = Math.round(isRiverWater * 255);
        roughImg.data[idx4 + 3] = 255;

        elevationField[pIdx] = elevation;
      }
    }
  }

  dayCtx.putImageData(dayImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  // Subtle crisp shoreline anti-aliased sheen in Day Albedo
  strokePolygonList(dayCtx, CONTINENT_POLYGONS, W, H, 'rgba(186, 230, 253, 0.08)', 0.9 * resScale);

  // 4. Compute True Tangent-Space RGB Normal Map from continuous elevationField via 3x3 Sobel
  const normalStrength = use4K ? 5.2 : 4.2;
  for (let y = 0; y < H; y++) {
    const yUp = Math.max(0, y - 1);
    const yDn = Math.min(H - 1, y + 1);
    const latRad = ((90 - ((y + 0.5) / H) * 180) * Math.PI) / 180;
    const cosLatInv = 1.0 / Math.max(0.24, Math.cos(latRad));

    for (let x = 0; x < W; x++) {
      const xLt = (x - 1 + W) % W;
      const xRt = (x + 1) % W;

      const tl = elevationField[yUp * W + xLt];
      const tc = elevationField[yUp * W + x];
      const tr = elevationField[yUp * W + xRt];
      const ml = elevationField[y * W + xLt];
      const mr = elevationField[y * W + xRt];
      const bl = elevationField[yDn * W + xLt];
      const bc = elevationField[yDn * W + x];
      const br = elevationField[yDn * W + xRt];

      // Sobel gradients with spherical latitude correction so polar normals never distort
      const dx = (tr + 2 * mr + br - (tl + 2 * ml + bl)) * normalStrength * Math.min(2.2, cosLatInv);
      const dy = (bl + 2 * bc + br - (tl + 2 * tc + tr)) * normalStrength;

      let nx = -dx;
      let ny = dy;
      let nz = 1.0;
      const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx4 = (y * W + x) * 4;
      normalImg.data[idx4] = Math.round((nx * 0.5 + 0.5) * 255);
      normalImg.data[idx4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalImg.data[idx4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalImg.data[idx4 + 3] = 255;
    }
  }
  normalCtx.putImageData(normalImg, 0, 0);

  // 5. Synthesize 4K/2K Black Marble Night City Lights Map (interconnected road webs + sodium-vapor cores)
  const nightCanvas = document.createElement('canvas');
  nightCanvas.width = W;
  nightCanvas.height = H;
  const nightCtx = nightCanvas.getContext('2d')!;
  nightCtx.fillStyle = '#000000';
  nightCtx.fillRect(0, 0, W, H);

  let seed = 42197;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Inter-city arterial highway filaments (warm sodium-vapor #ffaa44 glow + bright core threads)
  nightCtx.globalCompositeOperation = 'lighter';
  for (const [a, b] of URBAN_HIGHWAY_CORRIDORS) {
    const ax = lonToX(a[0], W);
    const ay = latToY(a[1], H);
    const bx = lonToX(b[0], W);
    const by = latToY(b[1], H);
    const midX = (ax + bx) * 0.5 + (rand() - 0.5) * 14 * resScale;
    const midY = (ay + by) * 0.5 + (rand() - 0.5) * 10 * resScale;

    // Soft amber corridor glow
    nightCtx.strokeStyle = 'rgba(255, 160, 56, 0.22)';
    nightCtx.lineWidth = 3.2 * resScale;
    nightCtx.beginPath();
    nightCtx.moveTo(ax, ay);
    nightCtx.quadraticCurveTo(midX, midY, bx, by);
    nightCtx.stroke();

    // Fine bright highway filament
    nightCtx.strokeStyle = 'rgba(255, 206, 118, 0.58)';
    nightCtx.lineWidth = 0.95 * resScale;
    nightCtx.beginPath();
    nightCtx.moveTo(ax, ay);
    nightCtx.quadraticCurveTo(midX, midY, bx, by);
    nightCtx.stroke();

    // Small towns dotted along the corridor
    const stops = 5 + Math.floor(rand() * 5);
    for (let s = 1; s < stops; s++) {
      const t = s / stops;
      const omt = 1 - t;
      const px = omt * omt * ax + 2 * omt * t * midX + t * t * bx;
      const py = omt * omt * ay + 2 * omt * t * midY + t * t * by;
      const r = (0.7 + rand() * 1.1) * resScale;
      nightCtx.fillStyle = `rgba(255, 198, 108, ${0.42 + rand() * 0.4})`;
      nightCtx.beginPath();
      nightCtx.arc(px, py, r, 0, Math.PI * 2);
      nightCtx.fill();
    }
  }

  // Metropolitan cores, radiating highway spokes, and suburban webs
  for (const [clon, clat, spread, brightness] of CITY_LIGHT_CLUSTERS) {
    const cx = lonToX(clon, W);
    const cy = latToY(clat, H);
    const radPx = (spread / 360) * W * 1.28;

    // Warm outer urban glow
    const grad = nightCtx.createRadialGradient(cx, cy, 0, cx, cy, radPx * 1.15);
    grad.addColorStop(0, `rgba(255, 242, 204, ${0.95 * brightness})`);
    grad.addColorStop(0.22, `rgba(255, 202, 112, ${0.58 * brightness})`);
    grad.addColorStop(0.58, `rgba(255, 152, 52, ${0.22 * brightness})`);
    grad.addColorStop(1, 'rgba(255, 110, 20, 0)');
    nightCtx.fillStyle = grad;
    nightCtx.beginPath();
    nightCtx.arc(cx, cy, radPx * 1.15, 0, Math.PI * 2);
    nightCtx.fill();

    // Radiating local ring-road spokes around major metros
    const spokeCount = Math.floor(4 + brightness * 5);
    nightCtx.strokeStyle = `rgba(255, 184, 84, ${0.32 * brightness})`;
    nightCtx.lineWidth = 0.75 * resScale;
    for (let k = 0; k < spokeCount; k++) {
      const ang = (k / spokeCount) * Math.PI * 2 + rand() * 0.5;
      const len = radPx * (0.45 + rand() * 0.65);
      nightCtx.beginPath();
      nightCtx.moveTo(cx, cy);
      nightCtx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len * 0.7);
      nightCtx.stroke();
    }

    // High-resolution satellite urban nodes & bright white-gold downtown core
    const subCount = Math.floor(42 * brightness + 16);
    for (let s = 0; s < subCount; s++) {
      const ang = rand() * Math.PI * 2;
      const dist = Math.pow(rand(), 0.72) * spread * 1.3;
      const slon = clon + Math.cos(ang) * dist * 1.2;
      const slat = clat + Math.sin(ang) * dist * 0.72;
      const px = Math.round(lonToX(slon, W));
      const py = Math.round(latToY(slat, H));
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      if (landMask[py * W + px] === 0) continue;

      const dotR = (0.65 + rand() * 1.55) * resScale;
      const alpha = (0.46 + rand() * 0.54) * brightness;
      const isCore = dist < spread * 0.25 || rand() > 0.72;
      nightCtx.fillStyle = isCore
        ? `rgba(255, 244, 212, ${alpha})`
        : `rgba(255, 178, 72, ${alpha})`;
      nightCtx.beginPath();
      nightCtx.arc(px, py, dotR, 0, Math.PI * 2);
      nightCtx.fill();
    }
  }
  nightCtx.globalCompositeOperation = 'source-over';

  // Strictly clip halo bleed over ocean pixels for razor-sharp coastal silhouettes at night
  const nightImg = nightCtx.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) {
    if (landMask[i] === 0) {
      const i4 = i * 4;
      nightImg.data[i4] *= 0.03;
      nightImg.data[i4 + 1] *= 0.03;
      nightImg.data[i4 + 2] *= 0.03;
    }
  }
  nightCtx.putImageData(nightImg, 0, 0);

  // 6. Synthesize Scientific Overlays (1K Thermal, CO2, Tectonic) & Volumetric Dual-Layer Clouds
  const thermalCanvas = document.createElement('canvas');
  thermalCanvas.width = OW;
  thermalCanvas.height = OH;
  const thermalCtx = thermalCanvas.getContext('2d')!;
  const thermalImg = thermalCtx.createImageData(OW, OH);

  const co2Canvas = document.createElement('canvas');
  co2Canvas.width = OW;
  co2Canvas.height = OH;
  const co2Ctx = co2Canvas.getContext('2d')!;
  const co2Img = co2Ctx.createImageData(OW, OH);

  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = CW;
  cloudCanvas.height = CH;
  const cloudCtx = cloudCanvas.getContext('2d')!;
  const cloudImg = cloudCtx.createImageData(CW, CH);

  const cirrusCanvas = document.createElement('canvas');
  cirrusCanvas.width = CW;
  cirrusCanvas.height = CH;
  const cirrusCtx = cirrusCanvas.getContext('2d')!;
  const cirrusImg = cirrusCtx.createImageData(CW, CH);

  // Precompute synoptic curled fBm cloud & jet-stream cirrus modulation fields at 1024x512
  const cloudCurlField = new Float32Array(OW * OH);
  const cirrusField = new Float32Array(OW * OH);
  const rainBandField = new Float32Array(OW * OH);

  for (let y = 0; y < OH; y++) {
    const lat = 90 - ((y + 0.5) / OH) * 180;
    const absLat = Math.abs(lat);
    const latRad = (lat * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);
    const maskY = Math.min(H - 1, Math.floor((y / OH) * H));

    // Realistic meteorological cloud belts: ITCZ equatorial band + mid-latitude cyclone storm tracks
    const itczBand = Math.exp(-Math.pow((lat - 4.0) / 10.5, 2)) * 0.24;
    const stormTrack = Math.exp(-Math.pow((absLat - 48.0) / 14.0, 2)) * 0.22;
    const subtropicDry = Math.exp(-Math.pow((absLat - 25.0) / 9.5, 2)) * 0.16;

    for (let x = 0; x < OW; x++) {
      const lon = ((x + 0.5) / OW) * 360 - 180;
      const lonRad = (lon * Math.PI) / 180;
      const maskX = Math.min(W - 1, Math.floor((x / OW) * W));
      const land = landMask[maskY * W + maskX] > 0;

      const sx = cosLat * Math.cos(lonRad);
      const sy = sinLat;
      const sz = cosLat * Math.sin(lonRad);

      const pIdx = y * OW + x;
      const idx4 = pIdx * 4;

      // Curled Coriolis vortex warp for cyclonic storm spirals and trade-wind cumulus streaks
      const coriolisSign = lat >= 0 ? 1 : -1;
      const wx = fbm3(sx * 3.4 + 1.4, sy * 3.4, sz * 3.4 - 2.0, 3) - 0.5;
      const wz = fbm3(sx * 3.4 - 3.9, sy * 3.4 + 2.2, sz * 3.4 + 1.6, 3) - 0.5;
      const curlX = sx + (wx * 0.65 - wz * 0.42 * coriolisSign);
      const curlZ = sz + (wz * 0.65 + wx * 0.42 * coriolisSign);

      const primaryCurl = fbm3(curlX * 6.8, sy * 9.2, curlZ * 6.8, 4);
      const cumulusDetail = fbm3(curlX * 18.0 + 3.1, sy * 18.0 - 1.7, curlZ * 18.0, 3);
      cloudCurlField[pIdx] = clamp01(
        primaryCurl * 0.72 + cumulusDetail * 0.28 + itczBand + stormTrack - subtropicDry,
      );

      // Stretched high-altitude wispy jet-stream cirrus filaments
      const jetStreak = fbm3(
        (sx + wx * 0.85) * 4.5 + 9.4,
        sy * 19.5 - 3.2,
        (sz + wz * 0.85) * 4.5 - 4.1,
        4,
      );
      const cirrusFine = ridgedFbm3(
        (sx - wz * 0.45) * 11.5,
        sy * 26.0,
        (sz + wx * 0.45) * 11.5,
        3,
      );
      cirrusField[pIdx] = clamp01(
        smoothstep(0.46, 0.84, jetStreak * 0.65 + cirrusFine * 0.35 + stormTrack * 0.6),
      );

      rainBandField[pIdx] = fbm3(
        (sx + wz * 0.65) * 10.0 + 4.2,
        sy * 11.4 - 1.3,
        (sz - wx * 0.65) * 10.0,
        3,
      );

      // Surface Thermal Overlay
      const latTemp = Math.cos(latRad * 1.05);
      const anomaly = (fbm3(sx * 4.5 + 8.0, sy * 4.5, sz * 4.5, 3) - 0.5) * 0.24;
      let desertHeat = 0;
      if (land) {
        for (let d = 0; d < 6; d++) {
          const [dlon, dlat, rlon, rlat] = DESERT_ZONES[d];
          const dx = (lon - dlon) / (rlon * 1.15);
          const dy = (lat - dlat) / (rlat * 1.15);
          desertHeat = Math.max(desertHeat, Math.exp(-(dx * dx + dy * dy) * 1.4) * 0.25);
        }
      }
      const thermalVal = clamp01(latTemp * 0.78 + anomaly + desertHeat + (land ? 0.04 : -0.02));
      const [tr, tg, tb] = sampleRamp(THERMAL_STOPS, thermalVal);
      const landTint = land ? 1.0 : 0.76;
      thermalImg.data[idx4] = tr * landTint;
      thermalImg.data[idx4 + 1] = tg * landTint;
      thermalImg.data[idx4 + 2] = tb * landTint;
      thermalImg.data[idx4 + 3] = 255;

      // Atmospheric CO2 Overlay
      const nhBias = smoothstep(-35, 48, lat) * 0.42;
      const plumeNoise = fbm3(sx * 5.2 - 3.0, sy * 6.5, sz * 5.2 + 4.0, 3);
      let hotspot = 0;
      const basins: [number, number, number][] = [
        [114, 34, 24],
        [78, 25, 18],
        [10, 49, 20],
        [-84, 39, 22],
        [48, 28, 16],
      ];
      for (let b = 0; b < basins.length; b++) {
        const [blon, blat, brad] = basins[b];
        const dx = (lon - blon) / brad;
        const dy = (lat - blat) / (brad * 0.65);
        hotspot = Math.max(hotspot, Math.exp(-(dx * dx + dy * dy) * 1.2) * 0.45);
      }
      const co2Val = clamp01(0.18 + nhBias + (plumeNoise - 0.35) * 0.38 + hotspot);
      const [cr, cg, cb] = sampleRamp(CO2_STOPS, co2Val);
      const co2LandBoost = land ? 1.06 : 0.84;
      co2Img.data[idx4] = Math.min(255, cr * co2LandBoost);
      co2Img.data[idx4 + 1] = Math.min(255, cg * co2LandBoost);
      co2Img.data[idx4 + 2] = Math.min(255, cb * co2LandBoost);
      co2Img.data[idx4 + 3] = 255;
    }
  }

  thermalCtx.putImageData(thermalImg, 0, 0);
  co2Ctx.putImageData(co2Img, 0, 0);
  strokePolygonList(thermalCtx, CONTINENT_POLYGONS, OW, OH, 'rgba(255, 255, 255, 0.38)', 1.05);
  strokePolygonList(co2Ctx, CONTINENT_POLYGONS, OW, OH, 'rgba(226, 232, 240, 0.34)', 1.05);

  // Render high-altitude cirrus cloud canvas (CW x CH)
  for (let y = 0; y < CH; y++) {
    const v = (y + 0.5) / CH;
    for (let x = 0; x < CW; x++) {
      const u = (x + 0.5) / CW;
      const cVal = sampleFieldBilinear(cirrusField, OW, OH, u, v);
      const grain = (hash2(x, y) - 0.5) * 0.08;
      const alpha = clamp01(cVal + grain) * 0.72;
      const idx4 = (y * CW + x) * 4;
      cirrusImg.data[idx4] = 246;
      cirrusImg.data[idx4 + 1] = 250;
      cirrusImg.data[idx4 + 2] = 255;
      cirrusImg.data[idx4 + 3] = Math.round(alpha * 255);
    }
  }
  cirrusCtx.putImageData(cirrusImg, 0, 0);

  // 7. Synthesize 1K Tectonic Stress Overlay Map
  const tectonicCanvas = document.createElement('canvas');
  tectonicCanvas.width = OW;
  tectonicCanvas.height = OH;
  const tectonicCtx = tectonicCanvas.getContext('2d')!;
  tectonicCtx.fillStyle = '#09111f';
  tectonicCtx.fillRect(0, 0, OW, OH);
  drawPolygonList(tectonicCtx, CONTINENT_POLYGONS, OW, OH, '#182538');
  drawPolygonList(tectonicCtx, MAJOR_LAKES, OW, OH, '#09111f');
  strokePolygonList(tectonicCtx, CONTINENT_POLYGONS, OW, OH, 'rgba(148, 163, 184, 0.4)', 1.05);

  const drawFaultPass = (lineWidth: number, color: string) => {
    strokePolylineList(tectonicCtx, TECTONIC_BOUNDARIES, OW, OH, color, lineWidth);
  };
  drawFaultPass(18, 'rgba(239, 68, 68, 0.16)');
  drawFaultPass(9, 'rgba(245, 158, 11, 0.4)');
  drawFaultPass(3.2, 'rgba(254, 215, 102, 0.95)');

  // 8. Real-Time Cloud Cover & Precipitation Radar Canvas (dynamically updatable from Open-Meteo)
  const precipCanvas = document.createElement('canvas');
  precipCanvas.width = OW;
  precipCanvas.height = OH;
  const precipCtx = precipCanvas.getContext('2d')!;
  const precipImg = precipCtx.createImageData(OW, OH);

  const GW = 160;
  const GH = 80;
  const coarseCloud = new Float32Array(GW * GH);
  const coarsePrecip = new Float32Array(GW * GH);
  const gridDirX = new Float32Array(GW * GH);
  const gridDirY = new Float32Array(GW * GH);
  const gridDirZ = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    const latRad = ((90 - ((gy + 0.5) / GH) * 180) * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);
    for (let gx = 0; gx < GW; gx++) {
      const lonRad = (((gx + 0.5) / GW) * 360 - 180) * (Math.PI / 180);
      const idx = gy * GW + gx;
      gridDirX[idx] = cosLat * Math.cos(lonRad);
      gridDirY[idx] = sinLat;
      gridDirZ[idx] = cosLat * Math.sin(lonRad);
    }
  }

  const configureTexture = (
    canvas: HTMLCanvasElement,
    isColor: boolean,
  ): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(16, maxAnisotropy);
    tex.needsUpdate = true;
    return tex;
  };

  const dayMap = configureTexture(dayCanvas, true);
  const nightMap = configureTexture(nightCanvas, true);
  const roughnessMap = configureTexture(roughCanvas, false);
  const normalMap = configureTexture(normalCanvas, false);
  const cloudMap = configureTexture(cloudCanvas, true);
  const cirrusMap = configureTexture(cirrusCanvas, true);
  const precipitationMap = configureTexture(precipCanvas, true);
  const thermalMap = configureTexture(thermalCanvas, true);
  const co2Map = configureTexture(co2Canvas, true);
  const tectonicMap = configureTexture(tectonicCanvas, true);

  const updateWeatherTextures = (samples: WeatherSample[]) => {
    if (samples.length === 0) return;

    const n = samples.length;
    const sX = new Float32Array(n);
    const sY = new Float32Array(n);
    const sZ = new Float32Array(n);
    const sCloud = new Float32Array(n);
    const sPrecip = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const latRad = (samples[i].lat * Math.PI) / 180;
      const lonRad = (samples[i].lon * Math.PI) / 180;
      const cosLat = Math.cos(latRad);
      sX[i] = cosLat * Math.cos(lonRad);
      sY[i] = Math.sin(latRad);
      sZ[i] = cosLat * Math.sin(lonRad);
      sCloud[i] = clamp01(samples[i].cloudCoverPct / 100);
      sPrecip[i] = samples[i].precipitationMm;
    }

    const cloudSharpness = 18.0;
    const precipSharpness = 32.0;

    for (let i = 0; i < GW * GH; i++) {
      const dx = gridDirX[i];
      const dy = gridDirY[i];
      const dz = gridDirZ[i];

      let cSum = 0;
      let cW = 0;
      let pSum = 0;
      let pW = 0;
      let pMaxLocal = 0;

      for (let j = 0; j < n; j++) {
        const dot = dx * sX[j] + dy * sY[j] + dz * sZ[j];
        if (dot < 0.35) continue;
        const dist = 1 - dot;
        const wc = Math.exp(-dist * cloudSharpness);
        cSum += sCloud[j] * wc;
        cW += wc;

        const wp = Math.exp(-dist * precipSharpness);
        pSum += sPrecip[j] * wp;
        pW += wp;
        if (sPrecip[j] * wp > pMaxLocal) {
          pMaxLocal = sPrecip[j] * wp;
        }
      }

      coarseCloud[i] = cW > 1e-5 ? cSum / cW : 0.25;
      const avgP = pW > 1e-5 ? pSum / pW : 0;
      coarsePrecip[i] = Math.max(avgP, pMaxLocal * 0.92);
    }

    // Update 1K precipitation radar overlay
    for (let y = 0; y < OH; y++) {
      const v = (y + 0.5) / OH;
      const maskY = Math.min(H - 1, Math.floor(v * H));
      for (let x = 0; x < OW; x++) {
        const u = (x + 0.5) / OW;
        const maskX = Math.min(W - 1, Math.floor(u * W));
        const land = landMask[maskY * W + maskX] > 0;
        const pIdx = y * OW + x;
        const idx4 = pIdx * 4;

        const baseCloud = sampleFieldBilinear(coarseCloud, GW, GH, u, v);
        const basePrecip = sampleFieldBilinear(coarsePrecip, GW, GH, u, v);
        const cNoise = cloudCurlField[pIdx];
        const rNoise = rainBandField[pIdx];

        const cloudDensity = smoothstep(0.24, 0.84, baseCloud * 0.72 + (cNoise - 0.36) * 0.68);

        let r = land ? 24 : 11;
        let g = land ? 36 : 20;
        let b = land ? 54 : 38;

        if (cloudDensity > 0.04) {
          const cMix = cloudDensity * 0.68;
          r = lerp(r, 94, cMix);
          g = lerp(g, 138, cMix);
          b = lerp(b, 186, cMix);
        }

        const modulatedPrecip = basePrecip * (0.45 + 0.95 * rNoise);
        if (modulatedPrecip > 0.06) {
          const normIntensity = clamp01(
            Math.log1p(modulatedPrecip * 1.45) / Math.log1p(22.0),
          );
          const radarAlpha = smoothstep(0.06, 0.42, modulatedPrecip) * 0.94;
          const [rr, rg, rb] = sampleRamp(PRECIP_RADAR_STOPS, normIntensity);
          r = lerp(r, rr, radarAlpha);
          g = lerp(g, rg, radarAlpha);
          b = lerp(b, rb, radarAlpha);
        }

        precipImg.data[idx4] = Math.min(255, r);
        precipImg.data[idx4 + 1] = Math.min(255, g);
        precipImg.data[idx4 + 2] = Math.min(255, b);
        precipImg.data[idx4 + 3] = 255;
      }
    }

    // Update high-res CW x CH primary cyclonic cloud layer with crisp cumulus wisps
    for (let y = 0; y < CH; y++) {
      const v = (y + 0.5) / CH;
      for (let x = 0; x < CW; x++) {
        const u = (x + 0.5) / CW;
        const baseCloud = sampleFieldBilinear(coarseCloud, GW, GH, u, v);
        const cNoise = sampleFieldBilinear(cloudCurlField, OW, OH, u, v);
        const microWisp = (hash2(x >> 1, y >> 1) - 0.5) * 0.09;
        const density = smoothstep(
          0.25,
          0.83,
          baseCloud * 0.72 + (cNoise - 0.34) * 0.7 + microWisp,
        );

        const idx4 = (y * CW + x) * 4;
        // Brighter white on thick cumulus cores, slightly softer blue-white on thin fringes
        const coreTone = Math.round(lerp(226, 255, density));
        cloudImg.data[idx4] = coreTone;
        cloudImg.data[idx4 + 1] = Math.min(255, coreTone + 3);
        cloudImg.data[idx4 + 2] = 255;
        cloudImg.data[idx4 + 3] = Math.round(clamp01(density) * 238);
      }
    }

    cloudCtx.putImageData(cloudImg, 0, 0);
    precipCtx.putImageData(precipImg, 0, 0);
    strokePolygonList(precipCtx, CONTINENT_POLYGONS, OW, OH, 'rgba(203, 213, 225, 0.38)', 1.05);

    cloudMap.needsUpdate = true;
    precipitationMap.needsUpdate = true;
  };

  updateWeatherTextures(buildModeledWeatherSnapshot().samples);

  return {
    dayMap,
    nightMap,
    roughnessMap,
    normalMap,
    cloudMap,
    cirrusMap,
    precipitationMap,
    thermalMap,
    co2Map,
    tectonicMap,
    resolutionLabel: use4K ? '4K' : '2K',
    updateWeatherTextures,
    dispose: () => {
      dayMap.dispose();
      nightMap.dispose();
      roughnessMap.dispose();
      normalMap.dispose();
      cloudMap.dispose();
      cirrusMap.dispose();
      precipitationMap.dispose();
      thermalMap.dispose();
      co2Map.dispose();
      tectonicMap.dispose();
    },
  };
}
