import * as THREE from 'three';
import {
  CITY_LIGHT_CLUSTERS,
  CONTINENT_POLYGONS,
  DESERT_ZONES,
  LUSH_BIOME_ZONES,
  MAJOR_LAKES,
  MOUNTAIN_RANGES,
  TECTONIC_BOUNDARIES,
  type LonLat,
} from './worldGeography';
import {
  buildModeledWeatherSnapshot,
  type WeatherSample,
} from '../services/weatherTelemetry';

export interface EarthTextureBundle {
  dayMap: THREE.CanvasTexture;
  nightMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  cloudMap: THREE.CanvasTexture;
  precipitationMap: THREE.CanvasTexture;
  thermalMap: THREE.CanvasTexture;
  co2Map: THREE.CanvasTexture;
  tectonicMap: THREE.CanvasTexture;
  updateWeatherTextures: (samples: WeatherSample[]) => void;
  dispose: () => void;
}

// Fast deterministic 3D hash & value noise (seamless across the sphere, zero seam at ±180°)
function hash3(ix: number, iy: number, iz: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1274126177);
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

function fbm3(x: number, y: number, z: number, octaves = 3): number {
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

export function createEarthTextures(maxAnisotropy: number): EarthTextureBundle {
  // High-resolution 2K primary maps + 1K scientific overlay maps for crisp high-zoom detail
  const W = 2048;
  const H = 1024;
  const OW = 1024;
  const OH = 512;

  // 1. Rasterize sharp, geographically accurate continental mask
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const maskCtx = maskCanvas.getContext('2d')!;
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, W, H);
  drawPolygonList(maskCtx, CONTINENT_POLYGONS, W, H, '#ffffff');
  drawPolygonList(maskCtx, MAJOR_LAKES, W, H, '#000000');
  const sharpMaskData = maskCtx.getImageData(0, 0, W, H).data;

  // Two-stage bathymetry distance fields (strictly used for ocean shelf/slope depth shading, NEVER distorting coastlines!)
  const shallowCanvas = document.createElement('canvas');
  shallowCanvas.width = W;
  shallowCanvas.height = H;
  const shallowCtx = shallowCanvas.getContext('2d')!;
  shallowCtx.fillStyle = '#000000';
  shallowCtx.fillRect(0, 0, W, H);
  shallowCtx.filter = 'blur(7px)';
  shallowCtx.drawImage(maskCanvas, 0, 0);
  shallowCtx.filter = 'none';
  const shallowData = shallowCtx.getImageData(0, 0, W, H).data;

  const slopeCanvas = document.createElement('canvas');
  slopeCanvas.width = W;
  slopeCanvas.height = H;
  const slopeCtx = slopeCanvas.getContext('2d')!;
  slopeCtx.fillStyle = '#000000';
  slopeCtx.fillRect(0, 0, W, H);
  slopeCtx.filter = 'blur(22px)';
  slopeCtx.drawImage(maskCanvas, 0, 0);
  slopeCtx.filter = 'none';
  const slopeData = slopeCtx.getImageData(0, 0, W, H).data;

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

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = W;
  bumpCanvas.height = H;
  const bumpCtx = bumpCanvas.getContext('2d')!;
  const bumpImg = bumpCtx.createImageData(W, H);

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
  cloudCanvas.width = OW;
  cloudCanvas.height = OH;
  const cloudCtx = cloudCanvas.getContext('2d')!;
  const cloudImg = cloudCtx.createImageData(OW, OH);

  // Land coverage byte mask (0..255) for exact masking of night lights & overlays
  const landMask = new Uint8Array(W * H);

  // Precompute trig tables for pixel-center equirectangular mapping (zero half-pixel drift!)
  const cosLonTable = new Float32Array(W);
  const sinLonTable = new Float32Array(W);
  const lonDegTable = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const lon = ((x + 0.5) / W) * 360 - 180;
    const rad = (lon * Math.PI) / 180;
    lonDegTable[x] = lon;
    cosLonTable[x] = Math.cos(rad);
    sinLonTable[x] = Math.sin(rad);
  }

  // 2. Synthesize 2K Day Albedo, Specular Roughness, and Topographic Bump Relief
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    const absLat = Math.abs(lat);
    const latRad = (lat * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);

    for (let x = 0; x < W; x++) {
      const lon = lonDegTable[x];
      const sx = cosLat * cosLonTable[x];
      const sy = sinLat;
      const sz = cosLat * sinLonTable[x];

      const pIdx = y * W + x;
      const idx4 = pIdx * 4;
      const sharpVal = sharpMaskData[idx4] / 255;
      const shallowVal = shallowData[idx4] / 255;
      const slopeVal = slopeData[idx4] / 255;

      // Keep coastlines geometrically faithful: only subtle high-frequency shoreline organic edge
      const microCoast =
        sharpVal > 0.02 && sharpVal < 0.98
          ? (noise3(sx * 48, sy * 48, sz * 48) - 0.5) * 0.12
          : 0;
      const landCov = clamp01(sharpVal + microCoast);
      const isLand = landCov >= 0.48;
      landMask[pIdx] = isLand ? 255 : 0;

      // Seamless 3D spherical multi-octave terrain & ocean detail
      const detailNoise = fbm3(sx * 16.0 + 7.2, sy * 16.0 + 1.4, sz * 16.0 - 4.8, 3);
      const fineNoise = noise3(sx * 44.0 - 1.3, sy * 44.0 + 5.7, sz * 44.0 + 2.9);

      if (!isLand) {
        // Ocean bathymetry: deep abyssal plain -> continental slope -> luminous coastal shelf
        const shelfNear = smoothstep(0.06, 0.52, shallowVal);
        const shelfWide = smoothstep(0.04, 0.48, slopeVal);
        const abyssalRelief = fbm3(sx * 6.5 - 2.2, sy * 6.5 + 4.1, sz * 6.5 + 1.1, 3);
        const polarSeaIce = smoothstep(75.5, 84.5, absLat + (detailNoise - 0.5) * 5.0);

        let r = lerp(7, 13, shelfWide) + lerp(0, 17, shelfNear) + abyssalRelief * 6;
        let g = lerp(22, 46, shelfWide) + lerp(0, 62, shelfNear) + abyssalRelief * 11;
        let b = lerp(49, 86, shelfWide) + lerp(0, 60, shelfNear) + abyssalRelief * 15;

        if (polarSeaIce > 0.01) {
          r = lerp(r, 208, polarSeaIce * 0.86);
          g = lerp(g, 224, polarSeaIce * 0.86);
          b = lerp(b, 238, polarSeaIce * 0.86);
        }

        dayImg.data[idx4] = Math.min(255, r);
        dayImg.data[idx4 + 1] = Math.min(255, g);
        dayImg.data[idx4 + 2] = Math.min(255, b);
        dayImg.data[idx4 + 3] = 255;

        // Smooth specular oceans (low roughness) vs matte sea ice
        const oceanRough = lerp(52, 132, polarSeaIce) + (fineNoise - 0.5) * 10;
        roughImg.data[idx4] = oceanRough;
        roughImg.data[idx4 + 1] = oceanRough;
        roughImg.data[idx4 + 2] = oceanRough;
        roughImg.data[idx4 + 3] = 255;

        const oceanBump = 64 + abyssalRelief * 18 + shelfNear * 8;
        bumpImg.data[idx4] = oceanBump;
        bumpImg.data[idx4 + 1] = oceanBump;
        bumpImg.data[idx4 + 2] = oceanBump;
        bumpImg.data[idx4 + 3] = 255;
      } else {
        // Arid desert evaluation
        let desert = 0;
        for (let d = 0; d < DESERT_ZONES.length; d++) {
          const [dlon, dlat, rlon, rlat, intensity] = DESERT_ZONES[d];
          const dx = (lon - dlon) / rlon;
          const dy = (lat - dlat) / rlat;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < 1.8) {
            desert = Math.max(desert, Math.exp(-dist2 * 1.45) * intensity);
          }
        }
        desert = clamp01(desert + (detailNoise - 0.5) * 0.18);

        // Lush river basin & rainforest evaluation
        let lush = 0;
        for (let l = 0; l < LUSH_BIOME_ZONES.length; l++) {
          const [llon, llat, rlon, rlat, strength] = LUSH_BIOME_ZONES[l];
          const dx = (lon - llon) / rlon;
          const dy = (lat - llat) / rlat;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < 1.8) {
            lush = Math.max(lush, Math.exp(-dist2 * 1.4) * strength);
          }
        }
        // Lush corridors (e.g. Nile Delta) cut cleanly into surrounding arid zones
        desert = clamp01(desert * (1 - lush * 0.85));

        // Mountain cordillera relief
        let mountain = 0;
        for (let m = 0; m < MOUNTAIN_RANGES.length; m++) {
          const [mlon, mlat, rlon, rlat, height] = MOUNTAIN_RANGES[m];
          const dx = (lon - mlon) / rlon;
          const dy = (lat - mlat) / rlat;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < 1.9) {
            mountain = Math.max(mountain, Math.exp(-dist2 * 1.55) * height);
          }
        }
        const ridge = 1 - Math.abs(detailNoise * 2 - 1);
        const fineRidge = 1 - Math.abs(fineNoise * 2 - 1);
        const elevation = clamp01(
          0.14 +
            detailNoise * 0.22 +
            fineNoise * 0.08 +
            mountain * (0.46 + ridge * 0.34 + fineRidge * 0.14),
        );

        const tropicFactor = smoothstep(25, 3, absLat);
        const borealFactor = smoothstep(48, 66, absLat);
        const inGreenland = lon > -66 && lon < -17 && lat > 60.5;
        const iceFactor = clamp01(
          smoothstep(67, 77, absLat + (detailNoise - 0.5) * 5.0) +
            (lat < -62.5 ? 0.96 : 0) +
            (inGreenland ? 0.88 * smoothstep(0.18, 0.72, shallowVal) : 0),
        );

        // Natural satellite biome palette
        let r = lerp(58, 28, tropicFactor);
        let g = lerp(92, 78, tropicFactor);
        let b = lerp(49, 37, tropicFactor);

        // Apply lush green basin tint
        if (lush > 0.04) {
          r = lerp(r, 25, lush * 0.65);
          g = lerp(g, 74, lush * 0.65);
          b = lerp(b, 34, lush * 0.65);
        }

        // Boreal taiga & tundra
        r = lerp(r, 48, borealFactor);
        g = lerp(g, 66, borealFactor);
        b = lerp(b, 49, borealFactor);

        // Micro-terrain foliage & soil variation
        const texMod = (detailNoise - 0.5) * 28 + (fineNoise - 0.5) * 14;
        r += texMod;
        g += texMod * 1.05;
        b += texMod * 0.72;

        // Warm sandstone & ochre deserts
        if (desert > 0.06) {
          const dMix = smoothstep(0.1, 0.76, desert);
          r = lerp(r, 182 + (detailNoise - 0.5) * 24 + (fineNoise - 0.5) * 12, dMix);
          g = lerp(g, 152 + (detailNoise - 0.5) * 20 + (fineNoise - 0.5) * 10, dMix);
          b = lerp(b, 106 + (detailNoise - 0.5) * 16, dMix);
        }

        // Alpine rock and snow-capped cordilleras
        if (elevation > 0.48) {
          const rockMix = smoothstep(0.48, 0.7, elevation);
          r = lerp(r, 104 + (fineNoise - 0.5) * 18, rockMix);
          g = lerp(g, 97 + (fineNoise - 0.5) * 16, rockMix);
          b = lerp(b, 90 + (fineNoise - 0.5) * 14, rockMix);

          const peakSnow = smoothstep(0.7, 0.88, elevation);
          r = lerp(r, 228, peakSnow);
          g = lerp(g, 236, peakSnow);
          b = lerp(b, 244, peakSnow);
        }

        // Polar ice caps (Antarctica, Greenland interior, high Arctic)
        if (iceFactor > 0.02) {
          const iMix = smoothstep(0.05, 0.82, iceFactor);
          r = lerp(r, 218 + (detailNoise - 0.5) * 16, iMix);
          g = lerp(g, 229 + (detailNoise - 0.5) * 14, iMix);
          b = lerp(b, 241 + (detailNoise - 0.5) * 10, iMix);
        }

        dayImg.data[idx4] = clamp01(r / 255) * 255;
        dayImg.data[idx4 + 1] = clamp01(g / 255) * 255;
        dayImg.data[idx4 + 2] = clamp01(b / 255) * 255;
        dayImg.data[idx4 + 3] = 255;

        const landRough = lerp(226, 152, iceFactor) - elevation * 16;
        roughImg.data[idx4] = landRough;
        roughImg.data[idx4 + 1] = landRough;
        roughImg.data[idx4 + 2] = landRough;
        roughImg.data[idx4 + 3] = 255;

        const landBump = 114 + elevation * 141;
        bumpImg.data[idx4] = landBump;
        bumpImg.data[idx4 + 1] = landBump;
        bumpImg.data[idx4 + 2] = landBump;
        bumpImg.data[idx4 + 3] = 255;
      }
    }
  }

  dayCtx.putImageData(dayImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);
  bumpCtx.putImageData(bumpImg, 0, 0);

  // Subtle crisp shoreline anti-aliased edge in Day Albedo so high-zoom coastlines stay super defined
  strokePolygonList(dayCtx, CONTINENT_POLYGONS, W, H, 'rgba(186, 230, 253, 0.09)', 0.9);

  // 3. Synthesize 2K Night City Lights Map (strictly masked to land)
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

  for (const [clon, clat, spread, brightness] of CITY_LIGHT_CLUSTERS) {
    const cx = lonToX(clon, W);
    const cy = latToY(clat, H);
    const radPx = (spread / 360) * W * 1.35;

    const grad = nightCtx.createRadialGradient(cx, cy, 0, cx, cy, radPx * 1.2);
    grad.addColorStop(0, `rgba(255, 228, 162, ${0.9 * brightness})`);
    grad.addColorStop(0.32, `rgba(255, 178, 74, ${0.44 * brightness})`);
    grad.addColorStop(1, 'rgba(255, 130, 30, 0)');
    nightCtx.fillStyle = grad;
    nightCtx.beginPath();
    nightCtx.arc(cx, cy, radPx * 1.2, 0, Math.PI * 2);
    nightCtx.fill();

    // High-resolution satellite urban nodes & arterial suburbs
    const subCount = Math.floor(34 * brightness + 14);
    for (let s = 0; s < subCount; s++) {
      const ang = rand() * Math.PI * 2;
      const dist = Math.pow(rand(), 0.68) * spread * 1.32;
      const slon = clon + Math.cos(ang) * dist * 1.22;
      const slat = clat + Math.sin(ang) * dist * 0.72;
      const px = Math.round(lonToX(slon, W));
      const py = Math.round(latToY(slat, H));
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      if (landMask[py * W + px] === 0) continue;

      const dotR = 0.8 + rand() * 1.9;
      const alpha = (0.48 + rand() * 0.52) * brightness;
      nightCtx.fillStyle =
        rand() > 0.35
          ? `rgba(255, 214, 132, ${alpha})`
          : `rgba(255, 246, 220, ${alpha})`;
      nightCtx.beginPath();
      nightCtx.arc(px, py, dotR, 0, Math.PI * 2);
      nightCtx.fill();
    }
  }

  // Strictly clip halo bleed over ocean pixels for razor-sharp coastal silhouettes at night
  const nightImg = nightCtx.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) {
    if (landMask[i] === 0) {
      const i4 = i * 4;
      nightImg.data[i4] *= 0.05;
      nightImg.data[i4 + 1] *= 0.05;
      nightImg.data[i4 + 2] *= 0.05;
    }
  }
  nightCtx.putImageData(nightImg, 0, 0);

  // 4. Synthesize 1K Thermal, CO2, and Synoptic Modulation Fields
  const cloudModField = new Float32Array(OW * OH);
  const rainBandField = new Float32Array(OW * OH);

  for (let y = 0; y < OH; y++) {
    const lat = 90 - ((y + 0.5) / OH) * 180;
    const latRad = (lat * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);
    const maskY = Math.min(H - 1, y * 2);

    for (let x = 0; x < OW; x++) {
      const lon = ((x + 0.5) / OW) * 360 - 180;
      const lonRad = (lon * Math.PI) / 180;
      const maskX = Math.min(W - 1, x * 2);
      const land = landMask[maskY * W + maskX] > 0;

      const sx = cosLat * Math.cos(lonRad);
      const sy = sinLat;
      const sz = cosLat * Math.sin(lonRad);

      const pIdx = y * OW + x;
      const idx4 = pIdx * 4;

      // Synoptic fractal fields cached for real-time weather texture synthesis
      const wx = fbm3(sx * 3.1 + 1.4, sy * 3.1, sz * 3.1 - 2.0, 2) - 0.5;
      const wz = fbm3(sx * 3.1 - 3.9, sy * 3.1 + 2.2, sz * 3.1 + 1.6, 2) - 0.5;
      cloudModField[pIdx] = fbm3(
        (sx + wx * 0.55) * 6.5,
        sy * 8.6,
        (sz + wz * 0.55) * 6.5,
        3,
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

  // Crisp anti-aliased coastlines over scientific overlays
  strokePolygonList(thermalCtx, CONTINENT_POLYGONS, OW, OH, 'rgba(255, 255, 255, 0.38)', 1.05);
  strokePolygonList(co2Ctx, CONTINENT_POLYGONS, OW, OH, 'rgba(226, 232, 240, 0.34)', 1.05);

  // 5. Synthesize 1K Tectonic Stress Overlay Map
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
    tectonicCtx.strokeStyle = color;
    tectonicCtx.lineWidth = lineWidth;
    tectonicCtx.lineCap = 'round';
    tectonicCtx.lineJoin = 'round';
    for (const line of TECTONIC_BOUNDARIES) {
      tectonicCtx.beginPath();
      for (let i = 0; i < line.length; i++) {
        const px = lonToX(line[i][0], OW);
        const py = latToY(line[i][1], OH);
        if (i === 0) tectonicCtx.moveTo(px, py);
        else tectonicCtx.lineTo(px, py);
      }
      tectonicCtx.stroke();
    }
  };
  drawFaultPass(18, 'rgba(239, 68, 68, 0.16)');
  drawFaultPass(9, 'rgba(245, 158, 11, 0.4)');
  drawFaultPass(3.2, 'rgba(254, 215, 102, 0.95)');

  // 6. Real-Time Cloud Cover & Precipitation Radar Canvas (1K dynamically updatable)
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
  const bumpMap = configureTexture(bumpCanvas, false);
  const cloudMap = configureTexture(cloudCanvas, true);
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

    const sampleBilinear = (field: Float32Array, fx: number, fy: number) => {
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = (x0 + 1) % GW;
      const y1 = Math.min(GH - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const v00 = field[y0 * GW + x0];
      const v10 = field[y0 * GW + x1];
      const v01 = field[y1 * GW + x0];
      const v11 = field[y1 * GW + x1];
      return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
    };

    for (let y = 0; y < OH; y++) {
      const fy = clamp01((y + 0.5) / OH) * (GH - 1);
      const maskY = Math.min(H - 1, y * 2);

      for (let x = 0; x < OW; x++) {
        const fx = ((x + 0.5) / OW) * GW;
        const maskX = Math.min(W - 1, x * 2);
        const land = landMask[maskY * W + maskX] > 0;
        const pIdx = y * OW + x;
        const idx4 = pIdx * 4;

        const baseCloud = sampleBilinear(coarseCloud, fx, fy);
        const basePrecip = sampleBilinear(coarsePrecip, fx, fy);

        const cNoise = cloudModField[pIdx];
        const rNoise = rainBandField[pIdx];

        const cloudDensity = smoothstep(
          0.22,
          0.82,
          baseCloud * 0.78 + (cNoise - 0.38) * 0.62,
        );

        cloudImg.data[idx4] = 242;
        cloudImg.data[idx4 + 1] = 248;
        cloudImg.data[idx4 + 2] = 255;
        cloudImg.data[idx4 + 3] = Math.round(clamp01(cloudDensity) * 218);

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
    bumpMap,
    cloudMap,
    precipitationMap,
    thermalMap,
    co2Map,
    tectonicMap,
    updateWeatherTextures,
    dispose: () => {
      dayMap.dispose();
      nightMap.dispose();
      roughnessMap.dispose();
      bumpMap.dispose();
      cloudMap.dispose();
      precipitationMap.dispose();
      thermalMap.dispose();
      co2Map.dispose();
      tectonicMap.dispose();
    },
  };
}
