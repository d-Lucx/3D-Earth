import * as THREE from 'three';
import {
  CITY_LIGHT_CLUSTERS,
  CONTINENT_POLYGONS,
  DESERT_ZONES,
  MAJOR_LAKES,
  MOUNTAIN_RANGES,
  TECTONIC_BOUNDARIES,
  type LonLat,
} from './worldGeography';

export interface EarthTextureBundle {
  dayMap: THREE.CanvasTexture;
  nightMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  cloudMap: THREE.CanvasTexture;
  thermalMap: THREE.CanvasTexture;
  co2Map: THREE.CanvasTexture;
  tectonicMap: THREE.CanvasTexture;
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

function fbm3(x: number, y: number, z: number, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += amp * noise3(x * freq, y * freq, z * freq);
    freq *= 2.04;
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

// Color ramp sampler for scientific maps
function sampleRamp(stops: [number, number, number, number][], t: number): [number, number, number] {
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

export function createEarthTextures(maxAnisotropy: number): EarthTextureBundle {
  const W = 1280;
  const H = 640;

  // 1. Rasterize land mask + blurred coastal distance field
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const maskCtx = maskCanvas.getContext('2d')!;
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, W, H);
  drawPolygonList(maskCtx, CONTINENT_POLYGONS, W, H, '#ffffff');
  drawPolygonList(maskCtx, MAJOR_LAKES, W, H, '#000000');
  const sharpMaskData = maskCtx.getImageData(0, 0, W, H).data;

  // Blurred coastal shelf mask
  const shelfCanvas = document.createElement('canvas');
  shelfCanvas.width = W;
  shelfCanvas.height = H;
  const shelfCtx = shelfCanvas.getContext('2d')!;
  shelfCtx.fillStyle = '#000000';
  shelfCtx.fillRect(0, 0, W, H);
  shelfCtx.filter = 'blur(9px)';
  shelfCtx.drawImage(maskCanvas, 0, 0);
  shelfCtx.filter = 'none';
  const shelfData = shelfCtx.getImageData(0, 0, W, H).data;

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

  // Scientific overlay canvases (half resolution for fast synthesis + smooth GPU sampling)
  const OW = 640;
  const OH = 320;
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

  // Land bitmap for night lights & overlays
  const isLandMask = new Uint8Array(W * H);

  // 2. Synthesize Day Albedo, Roughness, and Bump Maps
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const lat = 90 - v * 180;
    const absLat = Math.abs(lat);
    const latRad = (lat * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);

    for (let x = 0; x < W; x++) {
      const u = x / W;
      const lon = u * 360 - 180;
      const lonRad = (lon * Math.PI) / 180;

      // Unit sphere direction for seamless 3D noise
      const sx = cosLat * Math.cos(lonRad);
      const sy = sinLat;
      const sz = cosLat * Math.sin(lonRad);

      const idx4 = (y * W + x) * 4;
      const sharp = sharpMaskData[idx4] / 255;
      const shelf = shelfData[idx4] / 255;

      // Natural coastline perturbation using spherical fBM
      const coastNoise = fbm3(sx * 9.5 + 3.1, sy * 9.5 - 1.7, sz * 9.5 + 2.3, 3);
      const landSignal = shelf * 0.65 + sharp * 0.55 + (coastNoise - 0.5) * 0.34;
      const isLand = landSignal > 0.54;
      isLandMask[y * W + x] = isLand ? 1 : 0;

      const detailNoise = fbm3(sx * 14.0 + 7.2, sy * 14.0 + 1.4, sz * 14.0 - 4.8, 4);

      if (!isLand) {
        // Bathymetric ocean shading: abyssal navy -> mid-ocean teal -> continental shelf cyan
        const shelfFactor = smoothstep(0.08, 0.54, shelf);
        const ridgeNoise = fbm3(sx * 5.0 - 2.2, sy * 5.0 + 4.1, sz * 5.0 + 1.1, 3);
        const polarSeaIce = smoothstep(74, 84, absLat + (detailNoise - 0.5) * 6);

        let r = lerp(8, 22, shelfFactor) + ridgeNoise * 8;
        let g = lerp(24, 96, shelfFactor) + ridgeNoise * 14;
        let b = lerp(52, 132, shelfFactor) + ridgeNoise * 16;

        // Subtle polar pack ice drift near extreme latitudes
        if (polarSeaIce > 0.01) {
          r = lerp(r, 206, polarSeaIce * 0.85);
          g = lerp(g, 222, polarSeaIce * 0.85);
          b = lerp(b, 236, polarSeaIce * 0.85);
        }

        dayImg.data[idx4] = Math.min(255, r);
        dayImg.data[idx4 + 1] = Math.min(255, g);
        dayImg.data[idx4 + 2] = Math.min(255, b);
        dayImg.data[idx4 + 3] = 255;

        const oceanRough = lerp(58, 125, polarSeaIce) + (detailNoise - 0.5) * 14;
        roughImg.data[idx4] = oceanRough;
        roughImg.data[idx4 + 1] = oceanRough;
        roughImg.data[idx4 + 2] = oceanRough;
        roughImg.data[idx4 + 3] = 255;

        const oceanBump = 68 + ridgeNoise * 18;
        bumpImg.data[idx4] = oceanBump;
        bumpImg.data[idx4 + 1] = oceanBump;
        bumpImg.data[idx4 + 2] = oceanBump;
        bumpImg.data[idx4 + 3] = 255;
      } else {
        // Compute desert factor
        let desert = 0;
        for (let d = 0; d < DESERT_ZONES.length; d++) {
          const [dlon, dlat, rlon, rlat, intensity] = DESERT_ZONES[d];
          const dx = (lon - dlon) / rlon;
          const dy = (lat - dlat) / rlat;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < 1.6) {
            desert = Math.max(desert, Math.exp(-dist2 * 1.4) * intensity);
          }
        }
        desert = clamp01(desert + (detailNoise - 0.5) * 0.22);

        // Compute mountain elevation factor
        let mountain = 0;
        for (let m = 0; m < MOUNTAIN_RANGES.length; m++) {
          const [mlon, mlat, rlon, rlat, height] = MOUNTAIN_RANGES[m];
          const dx = (lon - mlon) / rlon;
          const dy = (lat - mlat) / rlat;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < 1.8) {
            mountain = Math.max(mountain, Math.exp(-dist2 * 1.5) * height);
          }
        }
        const ridge = Math.abs(detailNoise * 2 - 1);
        const elevation = clamp01(
          0.18 + detailNoise * 0.28 + mountain * (0.52 + (1 - ridge) * 0.35),
        );

        // Biome color composition
        const tropicFactor = smoothstep(26, 4, absLat);
        const borealFactor = smoothstep(46, 65, absLat);
        const iceFactor = clamp01(
          smoothstep(65, 76, absLat + (detailNoise - 0.5) * 6) +
            (lat < -62 ? 0.95 : 0) +
            (lon > -65 && lon < -18 && lat > 62 ? 0.85 : 0),
        );

        // Base vegetation: temperate olive-green -> tropical emerald -> boreal dark spruce
        let r = lerp(52, 26, tropicFactor);
        let g = lerp(88, 76, tropicFactor);
        let b = lerp(46, 36, tropicFactor);

        r = lerp(r, 48, borealFactor);
        g = lerp(g, 66, borealFactor);
        b = lerp(b, 50, borealFactor);

        // Subtle terrestrial texture variation
        const texMod = (detailNoise - 0.5) * 32;
        r += texMod;
        g += texMod * 1.05;
        b += texMod * 0.7;

        // Blend desert ochre & warm sandstone
        if (desert > 0.05) {
          const dMix = smoothstep(0.12, 0.78, desert);
          r = lerp(r, 178 + (detailNoise - 0.5) * 26, dMix);
          g = lerp(g, 148 + (detailNoise - 0.5) * 22, dMix);
          b = lerp(b, 102 + (detailNoise - 0.5) * 18, dMix);
        }

        // Blend alpine rock and snow peaks
        if (elevation > 0.52) {
          const rockMix = smoothstep(0.52, 0.74, elevation);
          r = lerp(r, 106, rockMix);
          g = lerp(g, 99, rockMix);
          b = lerp(b, 92, rockMix);

          const peakSnow = smoothstep(0.72, 0.9, elevation);
          r = lerp(r, 224, peakSnow);
          g = lerp(g, 232, peakSnow);
          b = lerp(b, 240, peakSnow);
        }

        // Blend polar ice sheets (Antarctica, Greenland, Arctic tundra snow)
        if (iceFactor > 0.02) {
          const iMix = smoothstep(0.05, 0.85, iceFactor);
          r = lerp(r, 214 + (detailNoise - 0.5) * 18, iMix);
          g = lerp(g, 226 + (detailNoise - 0.5) * 16, iMix);
          b = lerp(b, 238 + (detailNoise - 0.5) * 12, iMix);
        }

        dayImg.data[idx4] = clamp01(r / 255) * 255;
        dayImg.data[idx4 + 1] = clamp01(g / 255) * 255;
        dayImg.data[idx4 + 2] = clamp01(b / 255) * 255;
        dayImg.data[idx4 + 3] = 255;

        const landRough = lerp(222, 148, iceFactor) - elevation * 18;
        roughImg.data[idx4] = landRough;
        roughImg.data[idx4 + 1] = landRough;
        roughImg.data[idx4 + 2] = landRough;
        roughImg.data[idx4 + 3] = 255;

        const landBump = 115 + elevation * 140;
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

  // 3. Synthesize Night City Lights Map (strictly masked to land)
  const nightCanvas = document.createElement('canvas');
  nightCanvas.width = W;
  nightCanvas.height = H;
  const nightCtx = nightCanvas.getContext('2d')!;
  nightCtx.fillStyle = '#000000';
  nightCtx.fillRect(0, 0, W, H);

  // Deterministic pseudo-random generator for crisp urban sub-clusters
  let seed = 42197;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (const [clon, clat, spread, brightness] of CITY_LIGHT_CLUSTERS) {
    const cx = lonToX(clon, W);
    const cy = latToY(clat, H);
    const radPx = (spread / 360) * W * 1.45;

    // Soft urban glow halo
    const grad = nightCtx.createRadialGradient(cx, cy, 0, cx, cy, radPx * 1.25);
    grad.addColorStop(0, `rgba(255, 224, 152, ${0.88 * brightness})`);
    grad.addColorStop(0.35, `rgba(255, 178, 72, ${0.46 * brightness})`);
    grad.addColorStop(1, 'rgba(255, 130, 30, 0)');
    nightCtx.fillStyle = grad;
    nightCtx.beginPath();
    nightCtx.arc(cx, cy, radPx * 1.25, 0, Math.PI * 2);
    nightCtx.fill();

    // Crisp individual satellite-resolved city & suburb nodes
    const subCount = Math.floor(24 * brightness + 10);
    for (let s = 0; s < subCount; s++) {
      const ang = rand() * Math.PI * 2;
      const dist = Math.pow(rand(), 0.65) * spread * 1.35;
      const slon = clon + Math.cos(ang) * dist * 1.25;
      const slat = clat + Math.sin(ang) * dist * 0.72;
      const px = Math.round(lonToX(slon, W));
      const py = Math.round(latToY(slat, H));
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      if (isLandMask[py * W + px] === 0) continue;

      const dotR = 0.7 + rand() * 1.6;
      const alpha = (0.45 + rand() * 0.55) * brightness;
      nightCtx.fillStyle =
        rand() > 0.35
          ? `rgba(255, 212, 128, ${alpha})`
          : `rgba(255, 244, 214, ${alpha})`;
      nightCtx.beginPath();
      nightCtx.arc(px, py, dotR, 0, Math.PI * 2);
      nightCtx.fill();
    }
  }

  // Mask out any halo spillover over ocean pixels so coastlines look razor-sharp at night
  const nightImg = nightCtx.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) {
    if (isLandMask[i] === 0) {
      const i4 = i * 4;
      nightImg.data[i4] *= 0.08;
      nightImg.data[i4 + 1] *= 0.08;
      nightImg.data[i4 + 2] *= 0.08;
    }
  }
  nightCtx.putImageData(nightImg, 0, 0);

  // 4. Synthesize Clouds, Thermal, and CO2 Maps (640x320)
  for (let y = 0; y < OH; y++) {
    const v = y / OH;
    const lat = 90 - v * 180;
    const absLat = Math.abs(lat);
    const latRad = (lat * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);
    const maskY = Math.min(H - 1, y * 2);

    for (let x = 0; x < OW; x++) {
      const u = x / OW;
      const lon = u * 360 - 180;
      const lonRad = (lon * Math.PI) / 180;
      const maskX = Math.min(W - 1, x * 2);
      const land = isLandMask[maskY * W + maskX] === 1;

      const sx = cosLat * Math.cos(lonRad);
      const sy = sinLat;
      const sz = cosLat * Math.sin(lonRad);

      const idx4 = (y * OW + x) * 4;

      // Clouds: domain-warped fBM along trade-wind and mid-latitude cyclone belts
      const warpX = fbm3(sx * 3.2 + 1.5, sy * 3.2, sz * 3.2 - 2.1, 3) - 0.5;
      const warpZ = fbm3(sx * 3.2 - 4.1, sy * 3.2 + 2.3, sz * 3.2 + 1.7, 3) - 0.5;
      const cloudN = fbm3(
        (sx + warpX * 0.55) * 6.0,
        sy * 8.5,
        (sz + warpZ * 0.55) * 6.0,
        4,
      );
      // ITCZ near equator + mid-latitude storm tracks (40–62°), drier subtropics (~25°)
      const itcz = Math.exp(-Math.pow((lat - 4) / 9, 2)) * 0.14;
      const stormTrack = Math.exp(-Math.pow((absLat - 50) / 14, 2)) * 0.12;
      const subtropicDry = Math.exp(-Math.pow((absLat - 25) / 10, 2)) * 0.1;
      const cloudDensity = smoothstep(0.51, 0.78, cloudN + itcz + stormTrack - subtropicDry);

      cloudImg.data[idx4] = 244;
      cloudImg.data[idx4 + 1] = 248;
      cloudImg.data[idx4 + 2] = 255;
      cloudImg.data[idx4 + 3] = Math.round(cloudDensity * 205);

      // Surface Thermal Overlay
      const latTemp = Math.cos(latRad * 1.05);
      const anomaly = (fbm3(sx * 4.5 + 8.0, sy * 4.5, sz * 4.5, 3) - 0.5) * 0.24;
      let desertHeat = 0;
      if (land) {
        for (let d = 0; d < 4; d++) {
          const [dlon, dlat, rlon, rlat] = DESERT_ZONES[d];
          const dx = (lon - dlon) / (rlon * 1.2);
          const dy = (lat - dlat) / (rlat * 1.2);
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

      // Atmospheric CO2 Overlay (northern hemisphere plume bias + advection waves)
      const nhBias = smoothstep(-35, 48, lat) * 0.42;
      const plumeNoise = fbm3(sx * 5.2 - 3.0, sy * 6.5, sz * 5.2 + 4.0, 3);
      let hotspot = 0;
      // Industrial / urban emission basins
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

  cloudCtx.putImageData(cloudImg, 0, 0);
  thermalCtx.putImageData(thermalImg, 0, 0);
  co2Ctx.putImageData(co2Img, 0, 0);

  // Subtle continental borders on thermal and CO2 overlays for instant geographic clarity
  const drawSubtleCoasts = (ctx: CanvasRenderingContext2D, stroke: string) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.9;
    for (const poly of CONTINENT_POLYGONS) {
      if (poly.length < 3) continue;
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const px = lonToX(poly[i][0], OW);
        const py = latToY(poly[i][1], OH);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  };
  drawSubtleCoasts(thermalCtx, 'rgba(255, 255, 255, 0.32)');
  drawSubtleCoasts(co2Ctx, 'rgba(226, 232, 240, 0.28)');

  // 5. Synthesize Tectonic Stress Overlay Map
  const tectonicCanvas = document.createElement('canvas');
  tectonicCanvas.width = OW;
  tectonicCanvas.height = OH;
  const tectonicCtx = tectonicCanvas.getContext('2d')!;
  tectonicCtx.fillStyle = '#09111f';
  tectonicCtx.fillRect(0, 0, OW, OH);
  drawPolygonList(tectonicCtx, CONTINENT_POLYGONS, OW, OH, '#182538');
  drawPolygonList(tectonicCtx, MAJOR_LAKES, OW, OH, '#09111f');
  drawSubtleCoasts(tectonicCtx, 'rgba(148, 163, 184, 0.35)');

  // Render glowing lithospheric fault lines & subduction strain halos
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
  drawFaultPass(12, 'rgba(239, 68, 68, 0.16)');
  drawFaultPass(6, 'rgba(245, 158, 11, 0.38)');
  drawFaultPass(2.2, 'rgba(254, 215, 102, 0.92)');

  const configureTexture = (
    canvas: HTMLCanvasElement,
    isColor: boolean,
  ): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = Math.min(8, maxAnisotropy);
    tex.needsUpdate = true;
    return tex;
  };

  const dayMap = configureTexture(dayCanvas, true);
  const nightMap = configureTexture(nightCanvas, true);
  const roughnessMap = configureTexture(roughCanvas, false);
  const bumpMap = configureTexture(bumpCanvas, false);
  const cloudMap = configureTexture(cloudCanvas, true);
  const thermalMap = configureTexture(thermalCanvas, true);
  const co2Map = configureTexture(co2Canvas, true);
  const tectonicMap = configureTexture(tectonicCanvas, true);

  return {
    dayMap,
    nightMap,
    roughnessMap,
    bumpMap,
    cloudMap,
    thermalMap,
    co2Map,
    tectonicMap,
    dispose: () => {
      dayMap.dispose();
      nightMap.dispose();
      roughnessMap.dispose();
      bumpMap.dispose();
      cloudMap.dispose();
      thermalMap.dispose();
      co2Map.dispose();
      tectonicMap.dispose();
    },
  };
}
