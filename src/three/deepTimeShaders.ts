import * as THREE from 'three';

export interface EarthShaderUniforms {
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uNightMap: { value: THREE.Texture | null };
  uOverlayMap: { value: THREE.Texture | null };
  uCloudMap: { value: THREE.Texture | null };
  uCloudRotOffset: { value: number };
  uCloudShadowStrength: { value: number };
  uOverlayMix: { value: number };
  uCityLightsIntensity: { value: number };
  uZoomFactor: { value: number };
  // Deep Time & Sandbox uniforms
  uMagmaFactor: { value: number };
  uIceCoverage: { value: number };
  uRiftMelt: { value: number };
  uOceanTintStrength: { value: number };
  uOceanTintRgb: { value: THREE.Color };
  uAtmosphereHue: { value: number };
  uAncientSurfaceMix: { value: number };
  uAshFactor: { value: number };
  uOxidationFactor: { value: number };
  uCo2Haze: { value: number };
  uCutaway: { value: number };
  uCutawayEnabled: { value: number };
  uCutawayOctant: { value: THREE.Vector3 };
  uOctantClipPlanes: { value: THREE.Vector3 };
}

export function createEarthShaderUniforms(): EarthShaderUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(1, 0.2, 0.5).normalize() },
    uNightMap: { value: null },
    uOverlayMap: { value: null },
    uCloudMap: { value: null },
    uCloudRotOffset: { value: 0 },
    uCloudShadowStrength: { value: 0.42 },
    uOverlayMix: { value: 0 },
    uCityLightsIntensity: { value: 1.0 },
    uZoomFactor: { value: 0 },
    uMagmaFactor: { value: 0 },
    uIceCoverage: { value: 0 },
    uRiftMelt: { value: 0 },
    uOceanTintStrength: { value: 0 },
    uOceanTintRgb: { value: new THREE.Color(0.06, 0.28, 0.42) },
    uAtmosphereHue: { value: 0 },
    uAncientSurfaceMix: { value: 0 },
    uAshFactor: { value: 0 },
    uOxidationFactor: { value: 0 },
    uCo2Haze: { value: 0 },
    uCutaway: { value: 0 },
    uCutawayEnabled: { value: 0 },
    uCutawayOctant: { value: new THREE.Vector3(1, 1, 1) },
    uOctantClipPlanes: { value: new THREE.Vector3(0, 0, 0) },
  };
}

// Reusable GLSL 3D procedural value noise & fBm chunk (seamless on sphere, zero texture fetches)
const GLSL_NOISE_3D = /* glsl */ `
float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

float fbm3d(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise3(p);
    p = p * 2.04 + vec3(13.1, -7.4, 5.2);
    a *= 0.5;
  }
  return v;
}
`;

/**
 * Patches Earth's MeshStandardMaterial with:
 * - Animated micro-wave ocean sun-glint specular & grazing Fresnel sky reflection
 * - Projected cloud drop-shadows offset toward uSunDir
 * - Warm amber/crimson twilight terminator scattering + valley relief AO
 * - Deep Time geological state morphs (Magma Ocean, Archean Iron Seas, Snowball Ice-Albedo + Volcanic Rifts, K-Pg Ash)
 * - 90° octant Core Cutaway clipping
 */
export function patchEarthMaterial(
  material: THREE.MeshStandardMaterial,
  uniforms: EarthShaderUniforms,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.uniforms.uNightMap = uniforms.uNightMap;
    shader.uniforms.uOverlayMap = uniforms.uOverlayMap;
    shader.uniforms.uCloudMap = uniforms.uCloudMap;
    shader.uniforms.uCloudRotOffset = uniforms.uCloudRotOffset;
    shader.uniforms.uCloudShadowStrength = uniforms.uCloudShadowStrength;
    shader.uniforms.uOverlayMix = uniforms.uOverlayMix;
    shader.uniforms.uCityLightsIntensity = uniforms.uCityLightsIntensity;
    shader.uniforms.uZoomFactor = uniforms.uZoomFactor;
    shader.uniforms.uMagmaFactor = uniforms.uMagmaFactor;
    shader.uniforms.uIceCoverage = uniforms.uIceCoverage;
    shader.uniforms.uRiftMelt = uniforms.uRiftMelt;
    shader.uniforms.uOceanTintStrength = uniforms.uOceanTintStrength;
    shader.uniforms.uOceanTintRgb = uniforms.uOceanTintRgb;
    shader.uniforms.uAtmosphereHue = uniforms.uAtmosphereHue;
    shader.uniforms.uAncientSurfaceMix = uniforms.uAncientSurfaceMix;
    shader.uniforms.uAshFactor = uniforms.uAshFactor;
    shader.uniforms.uOxidationFactor = uniforms.uOxidationFactor;
    shader.uniforms.uCo2Haze = uniforms.uCo2Haze;
    shader.uniforms.uCutaway = uniforms.uCutaway;
    shader.uniforms.uOctantClipPlanes = uniforms.uOctantClipPlanes;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vEarthWorldNormal;
        varying vec3 vEarthWorldPos;
        varying vec3 vEarthLocalPos;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vEarthLocalPos = position;
        vEarthWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        vEarthWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform sampler2D uNightMap;
        uniform sampler2D uOverlayMap;
        uniform sampler2D uCloudMap;
        uniform float uCloudRotOffset;
        uniform float uCloudShadowStrength;
        uniform float uOverlayMix;
        uniform float uCityLightsIntensity;
        uniform float uZoomFactor;
        uniform float uMagmaFactor;
        uniform float uIceCoverage;
        uniform float uRiftMelt;
        uniform float uOceanTintStrength;
        uniform vec3 uOceanTintRgb;
        uniform float uAtmosphereHue;
        uniform float uAncientSurfaceMix;
        uniform float uAshFactor;
        uniform float uOxidationFactor;
        uniform float uCo2Haze;
        varying vec3 vEarthWorldNormal;
        varying vec3 vEarthWorldPos;
        varying vec3 vEarthLocalPos;
        ${GLSL_NOISE_3D}
        // __OCTANT_CLIP_FRAGMENT_PARS__
        `,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        float cutawayRimGlow = 0.0;
        // __OCTANT_CLIP_FRAGMENT_MAIN__

        vec3 utilSample = vec3(1.0, 0.85, 0.0);
        #ifdef USE_ROUGHNESSMAP
          utilSample = texture2D( roughnessMap, vRoughnessMapUv ).rgb;
        #endif
        float valleyAO = utilSample.r;
        float waterMask = utilSample.b;

        vec3 unitLocal = normalize(vEarthLocalPos);
        float absLatNorm = abs(unitLocal.y);
        float geoNoise = 0.5;
        if (uMagmaFactor > 0.01 || uIceCoverage > 0.01 || uAncientSurfaceMix > 0.01 || uOxidationFactor > 0.01) {
          geoNoise = fbm3d(unitLocal * 6.5 + vec3(uTime * 0.025, 0.0, -uTime * 0.02));
        }

        // Compute dynamic Snowball ice mask once so albedo, roughness, and ocean glint stay consistent
        float iceMask = 0.0;
        float volcanicRiftGlow = 0.0;
        if (uIceCoverage > 0.01) {
          float effectiveIce = clamp(uIceCoverage * (1.0 - uRiftMelt * 0.72), 0.0, 1.0);
          float iceEdge = mix(1.06, -0.14, effectiveIce);
          float glacialNoise = (geoNoise - 0.5) * 0.22;
          iceMask = smoothstep(iceEdge - 0.14, iceEdge + 0.12, absLatNorm + glacialNoise);

          // Glowing equatorial volcanic rift cracks punching through Cryogenian ice
          float eqBelt = exp(-pow(unitLocal.y / 0.24, 2.0));
          float riftCrack = smoothstep(0.66 - uRiftMelt * 0.18, 0.84, 1.0 - abs(geoNoise * 2.0 - 1.0));
          volcanicRiftGlow = eqBelt * riftCrack * (0.28 + uRiftMelt * 1.35) * uIceCoverage;
          iceMask *= (1.0 - clamp(volcanicRiftGlow * 0.9, 0.0, 0.92));
        }

        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );

          // 1. Deep Time: Ancient basaltic / cratonized continents
          if (uAncientSurfaceMix > 0.01) {
            vec3 cratonCol = mix(vec3(0.08, 0.085, 0.095), vec3(0.24, 0.20, 0.16), geoNoise);
            sampledDiffuseColor.rgb = mix(
              sampledDiffuseColor.rgb,
              cratonCol,
              uAncientSurfaceMix * (1.0 - waterMask) * 0.82
            );
          }

          // 2. Deep Time: Archean iron-rich emerald seas & coastal Banded Iron rust shelves
          if (uOceanTintStrength > 0.01) {
            float oceanLuma = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            vec3 ancientSea = uOceanTintRgb * (0.68 + oceanLuma * 2.4);
            sampledDiffuseColor.rgb = mix(
              sampledDiffuseColor.rgb,
              ancientSea,
              uOceanTintStrength * waterMask * (1.0 - iceMask)
            );
          }
          if (uOxidationFactor > 0.01) {
            float coastalBand = smoothstep(0.32, 0.68, geoNoise) * (1.0 - abs(waterMask - 0.5) * 1.4);
            vec3 ironRust = vec3(0.46, 0.15, 0.09);
            sampledDiffuseColor.rgb = mix(
              sampledDiffuseColor.rgb,
              ironRust,
              clamp(coastalBand * uOxidationFactor * 0.48, 0.0, 0.55)
            );
          }

          // 3. Deep Time: Snowball Earth glacial albedo
          if (iceMask > 0.01) {
            vec3 glacialWhite = mix(vec3(0.74, 0.84, 0.94), vec3(0.92, 0.96, 1.0), geoNoise);
            sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, glacialWhite, iceMask * 0.94);
          }

          // 4. Deep Time: Hadean/Accretion cooling crust darkened beneath molten magma fissures
          if (uMagmaFactor > 0.01) {
            vec3 cooledBasalt = vec3(0.05, 0.04, 0.045) * (0.7 + 0.6 * geoNoise);
            sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, cooledBasalt, uMagmaFactor * 0.95);
          }

          // 5. Deep Time: Chicxulub K-Pg global impact ash / soot shroud
          if (uAshFactor > 0.01) {
            vec3 ashTone = vec3(0.11, 0.10, 0.095);
            sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, ashTone, uAshFactor * 0.78);
          }

          // 6. Telemetry scientific overlays (Precipitation / Thermal / CO2 / Tectonic)
          if (uOverlayMix > 0.005) {
            vec4 overlaySample = texture2D( uOverlayMap, vMapUv );
            sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, overlaySample.rgb, uOverlayMix);
          }

          // 7. Projected cloud drop-shadows offset toward uSunDir on sunlit hemisphere
          vec3 wnMap = normalize(vEarthWorldNormal);
          vec3 sDirMap = normalize(uSunDir);
          float ndlMap = dot(wnMap, sDirMap);
          if (uCloudShadowStrength > 0.01 && ndlMap > -0.08 && uMagmaFactor < 0.7) {
            vec3 upRef = vec3(0.0, 1.0, 0.0);
            vec3 east = normalize(cross(upRef, wnMap + vec3(0.0001, 0.0, 0.0001)));
            vec3 north = normalize(cross(wnMap, east));
            vec2 sunTangent = vec2(dot(sDirMap, east), dot(sDirMap, north));
            vec2 cloudUv = vec2(fract(vMapUv.x - uCloudRotOffset), vMapUv.y);
            vec2 shadowUv = vec2(
              fract(cloudUv.x + sunTangent.x * 0.0042),
              clamp(cloudUv.y - sunTangent.y * 0.0042, 0.001, 0.999)
            );
            float cloudAlpha = texture2D(uCloudMap, shadowUv).a;
            float dayMask = smoothstep(-0.08, 0.25, ndlMap);
            float shadowDim = 1.0 - cloudAlpha * uCloudShadowStrength * dayMask * (1.0 - uOverlayMix * 0.85) * (1.0 - uMagmaFactor);
            sampledDiffuseColor.rgb *= shadowDim;
          }

          // 8. Mountain valley relief ambient occlusion (deepens along low-angle solar terminator)
          float lowSunBoost = mix(1.0, 1.38, smoothstep(0.45, 0.02, ndlMap) * smoothstep(-0.1, 0.08, ndlMap));
          float aoFactor = mix(1.0, valleyAO, (1.0 - waterMask) * (1.0 - uOverlayMix * 0.7) * (1.0 - uMagmaFactor) * lowSunBoost);
          sampledDiffuseColor.rgb *= clamp(aoFactor, 0.45, 1.0);

          diffuseColor *= sampledDiffuseColor;
        #endif
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
          // Read roughness from G channel (R = valley AO, B = open water mask)
          roughnessFactor *= texelRoughness.g;
        #endif
        // Glacial ice and molten rock adjust surface roughness cleanly
        roughnessFactor = mix(roughnessFactor, 0.56, iceMask * 0.75);
        roughnessFactor = mix(roughnessFactor, 0.88, uMagmaFactor);
        `,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>
        vec3 wn = normalize(vEarthWorldNormal);
        vec3 sDir = normalize(uSunDir);
        vec3 viewDirW = normalize(cameraPosition - vEarthWorldPos);
        float ndl = dot(wn, sDir);
        float ndv = max(dot(viewDirW, wn), 0.0);

        // 1. Ocean Sun-Glint Specular & Grazing Fresnel Sky Reflection (masked to open water)
        float openWater = waterMask * (1.0 - iceMask) * (1.0 - uMagmaFactor) * (1.0 - uOverlayMix * 0.85) * (1.0 - uAshFactor * 0.8);
        if (openWater > 0.04 && ndl > -0.05) {
          // Animated multi-directional micro-wave normal perturbation
          vec3 wpWave = unitLocal * 88.0;
          float w1 = sin(wpWave.x * 1.4 + wpWave.z * 1.1 + uTime * 1.35);
          float w2 = cos(wpWave.y * 1.9 - wpWave.x * 1.2 - uTime * 1.05);
          float w3 = sin((wpWave.x - wpWave.y + wpWave.z) * 2.1 + uTime * 1.85);
          vec3 waveOffset = vec3(w1 + w3 * 0.5, w2 - w3 * 0.5, w1 * 0.5 - w2) * 0.022;
          vec3 waveN = normalize(wn + waveOffset);

          vec3 halfVec = normalize(sDir + viewDirW);
          float ndh = max(dot(waveN, halfVec), 0.0);
          float sunDayMask = smoothstep(-0.04, 0.22, ndl);

          // Broad shimmering solar path + crisp sub-solar specular core (tuned to trigger subtle bloom)
          float broadGlint = pow(ndh, 36.0) * 0.34;
          float sharpGlint = pow(ndh, 210.0) * 1.15;
          vec3 glintColor = mix(vec3(1.0, 0.94, 0.82), vec3(1.0, 0.56, 0.26), smoothstep(0.32, 0.0, ndl));
          totalEmissiveRadiance += glintColor * (broadGlint + sharpGlint) * openWater * sunDayMask;

          // Grazing-angle Fresnel sky reflection over ocean water
          float oceanFresnel = pow(1.0 - ndv, 4.2);
          vec3 skyReflectCol = mix(vec3(0.20, 0.52, 0.92), vec3(0.85, 0.44, 0.18), uAtmosphereHue);
          totalEmissiveRadiance += skyReflectCol * oceanFresnel * openWater * sunDayMask * 0.42;
        }

        // 2. Night-Side Black Marble City Lights emerging cleanly across the solar terminator
        float nightFactor = smoothstep(0.14, -0.22, ndl);
        float cityMask = uCityLightsIntensity * (1.0 - uOverlayMix * 0.78) * (1.0 - uMagmaFactor) * (1.0 - uIceCoverage * 0.95) * (1.0 - uAshFactor * 0.75);
        if (cityMask > 0.01 && nightFactor > 0.005) {
          vec3 cityTex = texture2D(uNightMap, vMapUv).rgb;
          totalEmissiveRadiance += cityTex * nightFactor * cityMask * 1.55;
        }

        // 3. Scientific overlay self-illumination on night hemisphere for legibility
        if (uOverlayMix > 0.01) {
          vec3 overlaySelf = texture2D(uOverlayMap, vMapUv).rgb;
          totalEmissiveRadiance += overlaySelf * uOverlayMix * (0.28 + 0.24 * nightFactor);
        }

        // 4. Warm Amber/Crimson Twilight Terminator Scattering
        float twilightBand = smoothstep(-0.14, 0.02, ndl) * (1.0 - smoothstep(0.02, 0.20, ndl));
        vec3 twilightTint = mix(vec3(0.34, 0.11, 0.045), vec3(0.45, 0.18, 0.04), uAtmosphereHue);
        totalEmissiveRadiance += twilightTint * twilightBand * (1.0 - uOverlayMix * 0.7) * (1.0 - uMagmaFactor * 0.65);

        // 5. Deep Time: Procedural Molten Magma Ocean (fBm + Blackbody Emission)
        if (uMagmaFactor > 0.01) {
          vec3 mp = unitLocal * 5.2;
          vec3 warp = vec3(
            fbm3d(mp + vec3(uTime * 0.07, 1.3, -uTime * 0.05)),
            fbm3d(mp + vec3(-2.7, uTime * 0.06, 3.1)),
            fbm3d(mp + vec3(4.1, -uTime * 0.05, 1.9))
          );
          float mField = fbm3d(mp * 1.65 + warp * 1.45);
          float cracks = smoothstep(0.36, 0.76, mField);
          float hotCore = smoothstep(0.64, 0.88, mField);
          // Blackbody color ramp: deep crimson -> incandescent orange -> white-yellow plasma
          vec3 magmaCol = mix(vec3(0.18, 0.015, 0.005), vec3(1.15, 0.22, 0.02), cracks);
          magmaCol = mix(magmaCol, vec3(1.85, 1.25, 0.42), hotCore);
          totalEmissiveRadiance += magmaCol * uMagmaFactor * (0.65 + 0.65 * cracks);
        }

        // 6. Deep Time: Snowball Earth Equatorial Volcanic Rift Glow
        if (volcanicRiftGlow > 0.01) {
          vec3 riftCol = mix(vec3(1.0, 0.22, 0.04), vec3(1.8, 0.95, 0.35), clamp(volcanicRiftGlow, 0.0, 1.0));
          totalEmissiveRadiance += riftCol * volcanicRiftGlow * 0.95;
        }

        // 7. Deep Time: Archean Cyan Stromatolite Bioluminescent Margin Subtle Glow
        if (uOxidationFactor > 0.01) {
          float coastRim = smoothstep(0.15, 0.85, 1.0 - abs(waterMask - 0.5) * 2.0);
          float pulse = 0.75 + 0.25 * sin(uTime * 1.8 + unitLocal.x * 12.0);
          totalEmissiveRadiance += vec3(0.06, 0.46, 0.42) * coastRim * uOxidationFactor * pulse * 0.32;
        }

        // 8. Zoom-aware Atmospheric Fresnel Rim Scattering on sunlit horizon
        float fresnel = pow(1.0 - ndv, mix(3.6, 2.75, uZoomFactor));
        float sunSide = smoothstep(-0.24, 0.55, ndl);
        vec3 limbBase = mix(vec3(0.18, 0.56, 1.0), vec3(0.95, 0.46, 0.16), uAtmosphereHue);
        limbBase = mix(limbBase, vec3(0.55, 0.44, 0.32), uAshFactor * 0.75);
        float co2Boost = 1.0 + uCo2Haze * 0.45;
        totalEmissiveRadiance += limbBase * fresnel * sunSide * (0.42 + uZoomFactor * 0.42) * co2Boost;

        // 9. Crisp lithospheric crust bevel edge highlight along the peeled 90-degree octant cutaway
        if (cutawayRimGlow > 0.005) {
          totalEmissiveRadiance += vec3(0.32, 0.64, 0.92) * cutawayRimGlow * 0.78;
        }
        `,
      );
  };
  material.customProgramCacheKey = () => 'terra-atlas-earth-v4k-deeptime-cutaway-v3';
}

/**
 * Volumetric-style Cloud Layer ShaderMaterial (supports both lower cumulus & upper cirrus shells)
 * with Lambertian shading, silver-lining Mie forward scattering when backlit, twilight amber tint,
 * ash darkening, and 90° octant Core Cutaway clipping.
 */
export function createVolumetricCloudMaterial(
  cloudTexture: THREE.Texture,
  uniforms: EarthShaderUniforms,
  isCirrus: boolean,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCloudTex: { value: cloudTexture },
      uSunDir: uniforms.uSunDir,
      uOpacity: { value: isCirrus ? 0.34 : 0.76 },
      uAtmosphereHue: uniforms.uAtmosphereHue,
      uAshFactor: uniforms.uAshFactor,
      uCo2Haze: uniforms.uCo2Haze,
      uCutaway: uniforms.uCutaway,
      uOctantClipPlanes: uniforms.uOctantClipPlanes,
      uIsCirrus: { value: isCirrus ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec3 vLocalPos;
      void main() {
        vUv = uv;
        vLocalPos = position;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uCloudTex;
      uniform vec3 uSunDir;
      uniform float uOpacity;
      uniform float uAtmosphereHue;
      uniform float uAshFactor;
      uniform float uCo2Haze;
      uniform float uIsCirrus;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec3 vLocalPos;
      // __OCTANT_CLIP_FRAGMENT_PARS__

      void main() {
        // __OCTANT_CLIP_FRAGMENT_MAIN__

        vec4 tex = texture2D(uCloudTex, vUv);
        float density = tex.a;
        if (density < 0.015) discard;

        vec3 n = normalize(vWorldNormal);
        vec3 sDir = normalize(uSunDir);
        vec3 vDir = normalize(cameraPosition - vWorldPos);
        float ndl = dot(n, sDir);

        // Soft wrapped Lambertian scattering for volumetric cloud depth
        float diffuse = smoothstep(-0.22, 0.85, ndl);
        float nightAmbient = 0.045;

        // Warm sunset / sunrise glow along terminator
        float twilight = smoothstep(-0.18, 0.02, ndl) * (1.0 - smoothstep(0.02, 0.24, ndl));

        // Silver-lining Mie forward scattering when viewing backlit clouds near the limb
        float backScatter = pow(max(dot(-vDir, sDir), 0.0), 6.0);
        float limbFactor = pow(1.0 - max(dot(vDir, n), 0.0), 2.1);
        float silverLining = (0.35 + 0.65 * uIsCirrus) * backScatter * limbFactor * smoothstep(-0.28, 0.35, ndl) * 1.45;

        vec3 dayCol = mix(vec3(0.95, 0.97, 1.0), vec3(0.96, 0.78, 0.56), uAtmosphereHue * 0.72 + uCo2Haze * 0.22);
        dayCol = mix(dayCol, vec3(0.28, 0.24, 0.22), uAshFactor * 0.82);

        vec3 twilightCol = mix(vec3(1.05, 0.54, 0.24), vec3(0.75, 0.32, 0.14), uAshFactor);
        vec3 litCol = dayCol * (nightAmbient + diffuse * 0.96);
        litCol = mix(litCol, twilightCol, twilight * 0.55);
        litCol += vec3(1.0, 0.96, 0.88) * silverLining * (1.0 - uAshFactor * 0.7);

        float alpha = clamp(density * uOpacity * (0.38 + 0.62 * smoothstep(-0.35, 0.2, ndl)), 0.0, 0.95);
        gl_FragColor = vec4(litCol, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

/**
 * Inner front-side atmospheric horizon haze shell (curved blue/amber limb depth at high zoom).
 */
export function createHorizonHazeMaterial(
  uniforms: EarthShaderUniforms,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: uniforms.uSunDir,
      uZoomFactor: uniforms.uZoomFactor,
      uAtmosphereHue: uniforms.uAtmosphereHue,
      uAshFactor: uniforms.uAshFactor,
      uCo2Haze: uniforms.uCo2Haze,
      uCutaway: uniforms.uCutaway,
      uOctantClipPlanes: uniforms.uOctantClipPlanes,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform float uZoomFactor;
      uniform float uAtmosphereHue;
      uniform float uAshFactor;
      uniform float uCo2Haze;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec3 vLocalPos;
      // __OCTANT_CLIP_FRAGMENT_PARS__

      void main() {
        // __OCTANT_CLIP_FRAGMENT_MAIN__
        vec3 n = normalize(vWorldNormal);
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float ndv = max(dot(viewDir, n), 0.0);
        float limb = pow(1.0 - ndv, mix(5.0, 3.3, uZoomFactor));

        float sunDot = dot(n, normalize(uSunDir));
        float daySide = smoothstep(-0.30, 0.55, sunDot);
        float twilight = exp(-pow((sunDot + 0.02) / 0.17, 2.0));

        vec3 horizonBlue = mix(vec3(0.30, 0.74, 1.12), vec3(0.98, 0.56, 0.22), uAtmosphereHue);
        horizonBlue = mix(horizonBlue, vec3(0.45, 0.36, 0.28), uAshFactor * 0.72);
        vec3 sunsetAmber = vec3(1.12, 0.48, 0.18);
        vec3 col = mix(horizonBlue, sunsetAmber, twilight * 0.56);

        float co2Density = 1.0 + uCo2Haze * 0.55;
        float intensity = limb * (0.14 + 0.62 * daySide) * (0.52 + uZoomFactor * 0.72) * co2Density;
        gl_FragColor = vec4(col * (1.0 + uZoomFactor * 0.32), clamp(intensity, 0.0, 0.90));
      }
    `,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

/**
 * Physically inspired Rayleigh + Mie Outer Atmosphere (BackSide shader)
 * with exponential density falloff, sunlit blue Rayleigh limb, warm orange-red terminator
 * extinction, Mie forward scattering toward the Sun, and Deep Time greenhouse hue control.
 */
export function createAtmosphereMaterial(
  uniforms: EarthShaderUniforms,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: uniforms.uSunDir,
      uZoomFactor: uniforms.uZoomFactor,
      uAtmosphereHue: uniforms.uAtmosphereHue,
      uAshFactor: uniforms.uAshFactor,
      uCo2Haze: uniforms.uCo2Haze,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform float uZoomFactor;
      uniform float uAtmosphereHue;
      uniform float uAshFactor;
      uniform float uCo2Haze;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 n = normalize(vWorldNormal);
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        vec3 sDir = normalize(uSunDir);

        // Exponential atmospheric density falloff along BackSide grazing ray
        float cosTheta = max(dot(viewDir, -n), 0.0);
        float rim = clamp(1.0 - cosTheta, 0.0, 1.0);
        float expFalloff = exp(-pow((1.0 - rim) * mix(4.2, 3.2, uZoomFactor), 1.65)) * pow(rim, 1.8);

        float sunDot = dot(n, sDir);
        float daySide = smoothstep(-0.34, 0.55, sunDot);
        float terminator = exp(-pow((sunDot + 0.04) / 0.21, 2.0));

        // Mie forward-scattering solar halo when looking past the limb toward the Sun
        float viewSun = max(dot(-viewDir, sDir), 0.0);
        float miePhase = pow(viewSun, 9.0) * 0.55 + pow(viewSun, 38.0) * 0.65;

        // Rayleigh blue vs Deep Time Hadean/Archean amber-methane haze
        vec3 rayleighDay = mix(vec3(0.24, 0.64, 1.18), vec3(1.08, 0.52, 0.16), uAtmosphereHue);
        rayleighDay = mix(rayleighDay, vec3(0.46, 0.34, 0.26), uAshFactor * 0.72);
        vec3 extinctionCol = vec3(1.16, 0.42, 0.14);
        vec3 nightCol = mix(vec3(0.05, 0.14, 0.30), vec3(0.18, 0.08, 0.03), uAtmosphereHue);
        vec3 mieCol = vec3(1.15, 0.88, 0.62);

        vec3 scatterCol = mix(nightCol, rayleighDay, daySide);
        scatterCol = mix(scatterCol, extinctionCol, terminator * 0.58);
        scatterCol += mieCol * miePhase * smoothstep(-0.4, 0.4, sunDot) * (1.0 - uAshFactor * 0.5);

        float co2Boost = 1.0 + uCo2Haze * 0.42;
        float radiance = (1.02 + uZoomFactor * 0.48) * co2Boost;
        float alpha = expFalloff * (0.14 + 0.78 * daySide + miePhase * 0.22) * (0.95 + uZoomFactor * 0.25);

        gl_FragColor = vec4(scatterCol * radiance, clamp(alpha, 0.0, 1.0));
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

/**
 * Deep-Space Backdrop:
 * 1. Procedural Milky Way galactic dust & faint nebula band sky-sphere (zero external textures)
 * 2. Twinkling spectral starfield (O/B blue-white through K/M warm orange-red stars)
 */
export function buildDeepSpaceBackdrop(uTime: { value: number }): {
  group: THREE.Group;
  dispose: () => void;
} {
  const group = new THREE.Group();
  group.name = 'deep-space-backdrop';

  // 1. Faint procedural Milky Way galactic band dome
  const skyGeo = new THREE.SphereGeometry(84, 48, 32);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${GLSL_NOISE_3D}
      void main() {
        // Tilt galactic plane ~46° relative to ecliptic
        vec3 d = normalize(vDir);
        float c = cos(0.80);
        float s = sin(0.80);
        vec3 gd = vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c);

        float bandLat = abs(gd.y);
        float galacticBand = exp(-pow(bandLat / 0.22, 2.0));
        float wideGlow = exp(-pow(bandLat / 0.48, 2.0));

        float n1 = fbm3d(gd * 4.6 + vec3(1.2, -0.8, 2.5));
        float n2 = fbm3d(gd * 11.0 - vec3(3.1, 1.4, -2.0));
        float dustLane = smoothstep(0.42, 0.68, n2) * exp(-pow(bandLat / 0.075, 2.0));

        vec3 deepVoid = vec3(0.012, 0.018, 0.036);
        vec3 milkCool = vec3(0.055, 0.088, 0.148);
        vec3 milkWarm = vec3(0.105, 0.085, 0.075);

        vec3 col = deepVoid;
        col += milkCool * wideGlow * (0.28 + 0.72 * n1) * 0.55;
        col += mix(milkCool, milkWarm, smoothstep(0.35, 0.78, n1)) * galacticBand * n1 * 0.85;
        col *= (1.0 - dustLane * 0.52);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -10;
  group.add(skyMesh);

  // 2. Spectral twinkling starfield (3,600 stars with spectral classes O/B/A/F/G/K/M)
  const count = 3600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  const spectralPalette = [
    new THREE.Color('#9bb8ff'), // O/B blue-white
    new THREE.Color('#cad8ff'), // B/A pale blue
    new THREE.Color('#f4f6ff'), // A/F white
    new THREE.Color('#fff4d8'), // G yellow-white
    new THREE.Color('#ffd29c'), // K amber
    new THREE.Color('#ffb584'), // M red-orange
  ];

  let seed = 918273;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < count; i++) {
    let theta: number;
    let phi: number;
    const inBand = i < count * 0.42;
    if (inBand) {
      phi = rand() * Math.PI * 2;
      const bandLat = (rand() - 0.5) * 0.38 + (rand() - 0.5) * 0.24;
      theta = Math.PI / 2 - bandLat;
    } else {
      phi = rand() * Math.PI * 2;
      theta = Math.acos(2 * rand() - 1);
    }

    const r = 42 + rand() * 34;
    let x = r * Math.sin(theta) * Math.cos(phi);
    let y = r * Math.cos(theta);
    let z = r * Math.sin(theta) * Math.sin(phi);

    if (inBand) {
      const tilt = 0.80;
      const ny = y * Math.cos(tilt) - z * Math.sin(tilt);
      const nz = y * Math.sin(tilt) + z * Math.cos(tilt);
      y = ny;
      z = nz;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const c = spectralPalette[Math.floor(rand() * spectralPalette.length)];
    const brightness = 0.36 + Math.pow(rand(), 2.2) * 0.64;
    colors[i * 3] = c.r * brightness;
    colors[i * 3 + 1] = c.g * brightness;
    colors[i * 3 + 2] = c.b * brightness;

    sizes[i] = 1.1 + Math.pow(rand(), 3.2) * 3.8;
    phases[i] = rand() * Math.PI * 2;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime,
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vTwinkle;
      uniform float uTime;
      void main() {
        vColor = color;
        vTwinkle = 0.74 + 0.26 * sin(uTime * (1.2 + fract(aPhase) * 2.4) + aPhase * 6.2831);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * (150.0 / max(1.0, -mvPosition.z)), 1.0, 5.5);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float dist = length(c) * 2.0;
        if (dist > 1.0) discard;
        float core = exp(-dist * dist * 5.2);
        gl_FragColor = vec4(vColor * vTwinkle * 1.15, core * 0.92);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  group.add(stars);

  return {
    group,
    dispose: () => {
      skyGeo.dispose();
      skyMat.dispose();
      starGeo.dispose();
      starMat.dispose();
    },
  };
}

