import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  CAMERA_PRESETS,
  CATEGORY_COLORS,
  DATA_ARCS,
  EARTH_RADIUS,
  SATELLITES,
  STATIONS,
  latLonToVector3,
  vector3ToLatLon,
  type CameraPresetId,
  type DataLayerMode,
  type SelectedTarget,
} from '../data/earthData';
import {
  getDeepTimeChapter,
  type DeepTimeEraId,
  type DeepTimeSandboxDefaults,
  type StoryBeacon,
  type StoryBeaconAction,
} from '../data/deepTimeData';
import { createEarthTextures, type EarthTextureBundle } from './earthTextures';
import {
  buildDeepSpaceBackdrop,
  createAtmosphereMaterial,
  createEarthShaderUniforms,
  createHorizonHazeMaterial,
  createVolumetricCloudMaterial,
  patchEarthMaterial,
  type EarthShaderUniforms,
} from './deepTimeShaders';
import { buildDeepTimeRig, type DeepTimeRig } from './tectonicAnimator';
import { buildSatelliteMesh, disposeSharedSatelliteAssets } from './satelliteBuilder';
import {
  buildMagneticFieldRig,
  type MagneticFieldRig,
} from './magneticFieldBuilder';
import type { WeatherSample } from '../services/weatherTelemetry';
import {
  formatEventUtcTime,
  formatRelativeTime,
  magnitudeColorHex,
  type EarthquakeEvent,
} from '../services/seismicTelemetry';

export type AppMode = 'telemetry' | 'deep-time';

export interface SceneSettings {
  appMode: AppMode;
  dataMode: DataLayerMode;
  showClouds: boolean;
  showCityLights: boolean;
  showStations: boolean;
  showSatellites: boolean;
  showArcs: boolean;
  showGraticule: boolean;
  showMagneticField: boolean;
  showEarthquakes: boolean;
  autoRotate: boolean;
  solarHourUtc: number;
  solarAutoAdvance: boolean;
  selectedTarget: SelectedTarget | null;
  // Deep Time ("Chrono-Atlas") state
  deepTimeEra: DeepTimeEraId;
  coreCutaway: boolean;
  sandbox: DeepTimeSandboxDefaults;
  fieldCheckActive: boolean;
}

export interface HoverInfo {
  kind: 'station' | 'satellite' | 'earthquake' | 'beacon';
  id: string;
  label: string;
  sublabel: string;
  details?: string;
  accentColor?: string;
  x: number;
  y: number;
}

export interface MagneticProbeReading {
  lat: number;
  lon: number;
  intensityUt: number;
  inclinationDeg: number;
  declinationDeg: number;
}

export interface SatelliteLivePos {
  id: string;
  lat: number;
  lon: number;
}

export interface SceneCallbacks {
  onSelectTarget: (target: SelectedTarget | null) => void;
  onSelectBeacon?: (beacon: StoryBeacon) => void;
  onGlobeClickCoords?: (coords: { lat: number; lon: number }) => void;
  onHoverTarget: (hover: HoverInfo | null) => void;
  onCursorCoords: (coords: { lat: number; lon: number } | null) => void;
  onMagneticProbe: (reading: MagneticProbeReading | null) => void;
  onSolarHourTick: (hourUtc: number) => void;
  onSatellitePositions: (positions: SatelliteLivePos[]) => void;
  onWebGLUnavailable: () => void;
}

// Reusable module-scoped math helpers (zero GC allocations inside render loop)
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecC = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _colorTarget = new THREE.Color();

type OctantShellLayer = 'inner-core' | 'outer-core' | 'mantle' | 'crust';

// Procedural 3D value noise & fBm GLSL chunk for planetary interior shells (zero external textures)
const GLSL_INTERIOR_NOISE_3D = /* glsl */ `
float octHash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float octVNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = octHash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = octHash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = octHash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = octHash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = octHash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = octHash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = octHash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = octHash31(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

float octFbm3d(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * octVNoise3(p);
    p = p * 2.04 + vec3(13.1, -7.4, 5.2);
    a *= 0.5;
  }
  return v;
}
`;

// 90-degree octant clip GLSL fragment shader logic masking fragments in the selected octant
// using local object-space coordinates (x, y, z) and cutaway state uniforms.
// Discards fragments inside the selected 90-degree octant bounded by the three orthogonal planes:
//   ((localPos.x - clipPlanes.x) * octantSign.x) > peelOffset &&
//   ((localPos.y - clipPlanes.y) * octantSign.y) > peelOffset &&
//   ((localPos.z - clipPlanes.z) * octantSign.z) > peelOffset
const GLSL_OCTANT_CLIP_FN = /* glsl */ `
bool evaluateOctantClip(
  vec3 localPos,
  vec3 clipPlanes,
  vec3 octantSign,
  float cutawayEnabled,
  float cutawayProgress,
  float shellRadius,
  out float clipRimFactor
) {
  clipRimFactor = 0.0;
  if (cutawayEnabled < 0.5 && cutawayProgress <= 0.004) {
    return false;
  }
  vec3 signedLocal = (localPos - clipPlanes) * octantSign;
  float minOctantAxis = min(signedLocal.x, min(signedLocal.y, signedLocal.z));
  float peelOffset = (1.0 - smoothstep(0.0, 1.0, cutawayProgress)) * shellRadius * 0.58;
  if (minOctantAxis > peelOffset) {
    return true;
  }
  float rimBand = max(0.010, shellRadius * 0.028);
  clipRimFactor =
    smoothstep(peelOffset - rimBand, peelOffset, minOctantAxis) *
    smoothstep(0.0, 0.25, cutawayProgress);
  return false;
}
`;

const GLSL_OCTANT_CLIP_UNIFORM_DECLS = /* glsl */ `
uniform float uCutawayEnabled;
uniform float uCutaway;
uniform vec3 uCutawayOctant;
uniform vec3 uOctantClipPlanes;
${GLSL_OCTANT_CLIP_FN}
`;

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class EarthSceneEngine {
  private container: HTMLElement;
  private callbacks: SceneCallbacks;
  private isSoftwareGl: boolean;
  private disposed = false;

  private renderer!: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private textures!: EarthTextureBundle;
  private envRT: THREE.WebGLRenderTarget | null = null;

  // Scene hierarchy: axialTiltGroup -> earthGroup (enables Axial Tilt sandbox)
  private axialTiltGroup = new THREE.Group();
  private earthGroup = new THREE.Group();
  private earthMesh!: THREE.Mesh;
  private earthMaterial!: THREE.MeshStandardMaterial;
  private cloudMesh!: THREE.Mesh;
  private cloudMaterial!: THREE.ShaderMaterial;
  private cirrusMesh!: THREE.Mesh;
  private cirrusMaterial!: THREE.ShaderMaterial;
  private horizonHazeMaterial!: THREE.ShaderMaterial;
  private atmosphereMaterial!: THREE.ShaderMaterial;
  private deepSpaceBackdrop!: { group: THREE.Group; dispose: () => void };
  private coreCutawayGroup = new THREE.Group();
  private coreCutawayShellOffsets: {
    baseOffset: THREE.Vector3;
    clipPlanesUniform: { value: THREE.Vector3 };
  }[] = [];
  private coreCutawayCapMeshes: {
    xy: THREE.Mesh;
    yz: THREE.Mesh;
    xz: THREE.Mesh;
  } | null = null;
  private coreCutawayDisposables: { dispose: () => void }[] = [];
  private deepTimeRig!: DeepTimeRig;

  private graticuleGroup = new THREE.Group();
  private magneticFieldRig!: MagneticFieldRig;
  private earthquakesGroup = new THREE.Group();
  private stationsGroup = new THREE.Group();
  private focusPinGroup = new THREE.Group();
  private arcsGroup = new THREE.Group();
  private satellitesGroup = new THREE.Group();
  private sunLight!: THREE.DirectionalLight;

  // Unified Earth, Cloud, Atmosphere & Deep Time shader uniforms
  private earthUniforms: EarthShaderUniforms = createEarthShaderUniforms();
  private targetOverlayMix = 0.0;
  private targetCutaway = 0.0;

  // Interactive station markers
  private stationNodes = new Map<
    string,
    { group: THREE.Group; ring: THREE.Mesh; tip: THREE.Mesh; hitProxy: THREE.Mesh }
  >();
  // Real-time earthquake pins
  private earthquakeMap = new Map<string, EarthquakeEvent>();
  private seismicReferenceTimeMs = Date.now();
  private earthquakeNodes = new Map<
    string,
    {
      group: THREE.Group;
      tip: THREE.Mesh;
      waveRing: THREE.Mesh;
      waveMat: THREE.MeshBasicMaterial;
      phase: number;
      magScale: number;
      hitProxy: THREE.Mesh;
    }
  >();
  private earthquakeSharedGeos: {
    stem: THREE.CylinderGeometry;
    tip: THREE.OctahedronGeometry;
    baseRing: THREE.RingGeometry;
    waveRing: THREE.RingGeometry;
    proxy: THREE.SphereGeometry;
    proxyMat: THREE.MeshBasicMaterial;
  } | null = null;
  private interactiveProxies: THREE.Object3D[] = [];

  // Animated great-circle arcs & instanced signal packets
  private arcCurves: THREE.QuadraticBezierCurve3[] = [];
  private packetMesh!: THREE.InstancedMesh;
  private packetPhases: number[] = [];
  private packetSpeeds: number[] = [];

  // Orbital satellites
  private satEntries: {
    config: (typeof SATELLITES)[number];
    group: THREE.Group;
    orbitPlaneQuat: THREE.Quaternion;
    angle: number;
    hitProxy: THREE.Mesh;
  }[] = [];

  // Camera transition state
  private cameraFlyTarget: THREE.Vector3 | null = null;
  private trackingSatelliteId: string | null = null;

  // Settings & timing
  private settings: SceneSettings;
  private frameId = 0;
  private lastTimeMs = performance.now();
  private elapsedSec = 0;
  private lastSolarEmitMs = 0;
  private lastSatPosEmitMs = 0;
  private lastPointerMoveMs = 0;
  private pointerDownPos = { x: 0, y: 0 };

  // Raycaster
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();

  // Event handler refs for cleanup
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    container: HTMLElement,
    initialSettings: SceneSettings,
    callbacks: SceneCallbacks,
  ) {
    this.container = container;
    this.settings = { ...initialSettings, sandbox: { ...initialSettings.sandbox } };
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();

    this.init();
  }

  private init() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch {
      this.callbacks.onWebGLUnavailable();
      return;
    }

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x04070f, 1);

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.container.appendChild(canvas);

    // WebGL context resilience
    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    // Scene & Camera
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04070f);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.05, 160);
    const initialPreset = CAMERA_PRESETS[0];
    latLonToVector3(
      initialPreset.lat,
      initialPreset.lon,
      initialPreset.distance,
      this.camera.position,
    );

    // Studio PMREM Environment for crisp metallic satellite reflections
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.42;
    pmremGenerator.dispose();

    // OrbitControls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.065;
    this.controls.rotateSpeed = 0.58;
    this.controls.zoomSpeed = 0.85;
    this.controls.minDistance = 1.32;
    this.controls.maxDistance = 5.8;
    this.controls.addEventListener('start', this.handleUserOrbitStart);

    // Lighting Rig (warm solar key, cool space hemisphere fill, subtle orbital rim)
    this.sunLight = new THREE.DirectionalLight(0xfff5e4, 2.85);
    this.sunLight.position.set(10, 3, 6);
    this.scene.add(this.sunLight);

    const hemiLight = new THREE.HemisphereLight(0x7dd3fc, 0x0a1020, 0.22);
    this.scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.3);
    rimLight.position.set(-8, -2, -6);
    this.scene.add(rimLight);

    // Adaptive 4K/2K Procedural Textures (100% procedural Canvas + Sobel RGB Normal Map)
    this.textures = createEarthTextures(
      this.renderer.capabilities.getMaxAnisotropy(),
      !this.isSoftwareGl,
    );
    this.earthUniforms.uNightMap.value = this.textures.nightMap;
    this.earthUniforms.uOverlayMap.value = this.textures.thermalMap;
    this.earthUniforms.uCloudMap.value = this.textures.cloudMap;

    // Deep-Space Backdrop (twinkling spectral starfield + faint procedural Milky Way band)
    this.deepSpaceBackdrop = buildDeepSpaceBackdrop(this.earthUniforms.uTime);
    this.scene.add(this.deepSpaceBackdrop.group);

    // Core Planetary Hierarchy
    this.axialTiltGroup.add(this.earthGroup);
    this.scene.add(this.axialTiltGroup);

    this.buildEarthAndAtmosphere();
    this.buildCoreCutaway();
    this.buildDeepTime();
    this.buildGraticule();
    this.buildMagneticField();
    this.buildStations();
    this.buildEarthquakeLayer();
    this.buildFocusPin();
    this.buildGreatCircleArcs();
    this.buildSatellites();

    // Tuned GPU Atmospheric Bloom Post-Processing (targets sun-glint, city cores, magma & limb)
    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.composer.setSize(width, height);

      const renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(renderPass);

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.24, // refined baseline strength (ramps gracefully on close zoom or molten eras)
        0.44, // tight atmospheric & glint halo radius
        0.78, // calibrated high threshold preventing washed-out daytime highlights
      );
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new OutputPass());
    }

    // Apply initial settings
    this.updateSunDirection(this.settings.solarHourUtc);
    this.applySettings(this.settings);

    // Pre-warm shaders on GPU devices
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Interaction listeners
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.container);

    this.lastTimeMs = performance.now();
    this.tick();
  }

  private buildEarthAndAtmosphere() {
    // 1. Primary Earth Sphere (high-tessellation 128x84 with true tangent-space normalMap)
    const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, 128, 84);

    this.earthMaterial = new THREE.MeshStandardMaterial({
      map: this.textures.dayMap,
      roughnessMap: this.textures.roughnessMap,
      roughness: 0.96,
      metalness: 0.06,
      normalMap: this.textures.normalMap,
      normalScale: new THREE.Vector2(1.18, 1.18),
    });
    patchEarthMaterial(this.earthMaterial, this.earthUniforms);
    this.applyEarthSurfaceOctantClipShader(this.earthMaterial);

    this.earthMesh = new THREE.Mesh(earthGeo, this.earthMaterial);
    this.earthMesh.name = 'earth-surface';
    this.earthGroup.add(this.earthMesh);

    // 2. Volumetric Primary Lower Cloud Shell (1.006 radii, cyclonic/trade-wind clouds)
    const cloudGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.006, 96, 64);
    this.cloudMaterial = createVolumetricCloudMaterial(
      this.textures.cloudMap,
      this.earthUniforms,
      false,
    );
    this.applyOctantClipToShaderMaterial(this.cloudMaterial, 'vLocalPos');
    this.cloudMesh = new THREE.Mesh(cloudGeo, this.cloudMaterial);
    this.cloudMesh.renderOrder = 2;
    this.earthGroup.add(this.cloudMesh);

    // 3. Secondary High-Altitude Cirrus Shell (1.011 radii, independent faster parallax)
    const cirrusGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.011, 84, 56);
    this.cirrusMaterial = createVolumetricCloudMaterial(
      this.textures.cirrusMap,
      this.earthUniforms,
      true,
    );
    this.applyOctantClipToShaderMaterial(this.cirrusMaterial, 'vLocalPos');
    this.cirrusMesh = new THREE.Mesh(cirrusGeo, this.cirrusMaterial);
    this.cirrusMesh.renderOrder = 3;
    this.earthGroup.add(this.cirrusMesh);

    // 4. Inner Front-Side Atmospheric Horizon Haze Shell (deepens limb at high zoom)
    const hazeGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.015, 96, 64);
    this.horizonHazeMaterial = createHorizonHazeMaterial(this.earthUniforms);
    this.applyOctantClipToShaderMaterial(this.horizonHazeMaterial, 'vLocalPos');
    const hazeMesh = new THREE.Mesh(hazeGeo, this.horizonHazeMaterial);
    hazeMesh.renderOrder = 4;
    this.earthGroup.add(hazeMesh);

    // 5. Outer Atmospheric Rayleigh + Mie Scattering Halo (BackSide exponential falloff)
    const atmoGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.095, 96, 64);
    this.atmosphereMaterial = createAtmosphereMaterial(this.earthUniforms);
    const atmoMesh = new THREE.Mesh(atmoGeo, this.atmosphereMaterial);
    atmoMesh.renderOrder = 5;
    this.scene.add(atmoMesh);
  }

  /**
   * Injects the 90-degree octant clip fragment shader and cutaway state uniforms directly
   * into Earth's primary MeshStandardMaterial so fragments in the selected octant are discarded
   * based on local coordinates, exposing the concentric core, mantle, and crust layers.
   */
  private applyEarthSurfaceOctantClipShader(material: THREE.MeshStandardMaterial) {
    const prevOnBeforeCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prevOnBeforeCompile(shader, renderer);
      shader.uniforms.uCutawayEnabled = this.earthUniforms.uCutawayEnabled;
      shader.uniforms.uCutaway = this.earthUniforms.uCutaway;
      shader.uniforms.uCutawayOctant = this.earthUniforms.uCutawayOctant;
      shader.uniforms.uOctantClipPlanes = this.earthUniforms.uOctantClipPlanes;

      shader.fragmentShader = shader.fragmentShader
        .replace('// __OCTANT_CLIP_FRAGMENT_PARS__', GLSL_OCTANT_CLIP_UNIFORM_DECLS)
        .replace(
          '// __OCTANT_CLIP_FRAGMENT_MAIN__',
          /* glsl */ `
          if (
            evaluateOctantClip(
              vEarthLocalPos,
              uOctantClipPlanes,
              uCutawayOctant,
              uCutawayEnabled,
              uCutaway,
              length(vEarthLocalPos),
              cutawayRimGlow
            )
          ) {
            discard;
          }
          `,
        );
    };
  }

  /**
   * Injects the cutaway state uniforms and 90-degree octant fragment discard logic into
   * custom atmospheric/cloud ShaderMaterials so they peel cleanly in sync with Earth's surface.
   */
  private applyOctantClipToShaderMaterial(
    material: THREE.ShaderMaterial,
    localPosVarying: string,
  ) {
    material.uniforms.uCutawayEnabled = this.earthUniforms.uCutawayEnabled;
    material.uniforms.uCutaway = this.earthUniforms.uCutaway;
    material.uniforms.uCutawayOctant = this.earthUniforms.uCutawayOctant;
    material.uniforms.uOctantClipPlanes = this.earthUniforms.uOctantClipPlanes;

    material.fragmentShader = material.fragmentShader
      .replace('// __OCTANT_CLIP_FRAGMENT_PARS__', GLSL_OCTANT_CLIP_UNIFORM_DECLS)
      .replace(
        '// __OCTANT_CLIP_FRAGMENT_MAIN__',
        /* glsl */ `
        float _unusedOctantRim = 0.0;
        if (
          evaluateOctantClip(
            ${localPosVarying},
            uOctantClipPlanes,
            uCutawayOctant,
            uCutawayEnabled,
            uCutaway,
            length(${localPosVarying}),
            _unusedOctantRim
          )
        ) {
          discard;
        }
        `,
      );
  }

  /**
   * Creates a 90-degree octant-clipped ShaderMaterial for a concentric planetary interior shell
   * (solid inner core, liquid outer core, silicate mantle, or lithospheric crust).
   * Fragments are masked in GLSL using local coordinates against uClipPlanes and uCutawayOctant.
   */
  private createOctantShellMaterial(
    layer: OctantShellLayer,
    shellRadius: number,
    localPlaneOffset: THREE.Vector3,
    side: THREE.Side,
  ): THREE.ShaderMaterial {
    const octant = this.earthUniforms.uCutawayOctant.value;
    const clipPlanesUniform = {
      value: new THREE.Vector3(
        localPlaneOffset.x * octant.x + this.earthUniforms.uOctantClipPlanes.value.x,
        localPlaneOffset.y * octant.y + this.earthUniforms.uOctantClipPlanes.value.y,
        localPlaneOffset.z * octant.z + this.earthUniforms.uOctantClipPlanes.value.z,
      ),
    };
    this.coreCutawayShellOffsets.push({
      baseOffset: localPlaneOffset.clone(),
      clipPlanesUniform,
    });

    const layerId =
      layer === 'inner-core'
        ? 0.0
        : layer === 'outer-core'
          ? 1.0
          : layer === 'mantle'
            ? 2.0
            : 3.0;

    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.earthUniforms.uTime,
        uSunDir: this.earthUniforms.uSunDir,
        uCutawayEnabled: this.earthUniforms.uCutawayEnabled,
        uCutaway: this.earthUniforms.uCutaway,
        uCutawayOctant: this.earthUniforms.uCutawayOctant,
        uClipPlanes: clipPlanesUniform,
        uShellRadius: { value: shellRadius },
        uLayerId: { value: layerId },
      },
      vertexShader: /* glsl */ `
        varying vec3 vOctantLocalPos;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
          vOctantLocalPos = position;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform float uCutawayEnabled;
        uniform float uCutaway;
        uniform vec3 uCutawayOctant;
        uniform vec3 uClipPlanes;
        uniform float uShellRadius;
        uniform float uLayerId;
        varying vec3 vOctantLocalPos;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        ${GLSL_INTERIOR_NOISE_3D}
        ${GLSL_OCTANT_CLIP_FN}

        void main() {
          // 1. Discard fragments inside the selected 90-degree octant via local coordinates
          float clipRim = 0.0;
          if (
            evaluateOctantClip(
              vOctantLocalPos,
              uClipPlanes,
              uCutawayOctant,
              uCutawayEnabled,
              uCutaway,
              uShellRadius,
              clipRim
            )
          ) {
            discard;
          }

          vec3 dir = normalize(vOctantLocalPos);
          vec3 wn = normalize(vWorldNormal) * (gl_FrontFacing ? 1.0 : -1.0);
          vec3 vDir = normalize(cameraPosition - vWorldPos);
          vec3 sDir = normalize(uSunDir);
          float ndl = dot(wn, sDir);
          float ndv = max(dot(vDir, wn), 0.0);
          float fresnel = pow(1.0 - ndv, 2.2);
          float shade = 0.72 + 0.32 * smoothstep(-0.35, 0.85, ndl);

          vec3 col = vec3(1.0);
          if (uLayerId < 0.5) {
            // Solid Inner Core: crystalline Fe-Ni sphere with incandescent Fresnel glow
            float crystal = octFbm3d(dir * 8.6 + vec3(uTime * 0.12, -uTime * 0.08, 0.0));
            col = mix(vec3(1.22, 0.88, 0.34), vec3(1.76, 1.65, 1.22), crystal);
            col += vec3(0.48, 0.38, 0.18) * fresnel;
            col += vec3(0.45, 0.35, 0.15) * clipRim;
          } else if (uLayerId < 1.5) {
            // Liquid Outer Core: swirling molten iron-nickel geodynamo shell
            float swirl = octFbm3d(dir * 6.4 + vec3(uTime * 0.28, -uTime * 0.20, uTime * 0.14));
            float dynamo = octFbm3d(dir * 12.8 - vec3(0.0, uTime * 0.34, uTime * 0.18));
            col = mix(vec3(0.96, 0.28, 0.03), vec3(1.50, 0.80, 0.16), swirl * 0.68 + dynamo * 0.32);
            col *= (0.86 + 0.18 * shade);
            col += vec3(0.62, 0.38, 0.10) * clipRim;
          } else if (uLayerId < 2.5) {
            // Silicate Mantle: deep crimson convecting mantle plumes with warm tectonic rim
            float conv = octFbm3d(dir * 5.8 + vec3(uTime * 0.08, -uTime * 0.05, 0.0));
            float plume = octFbm3d(dir * 11.2 - vec3(uTime * 0.04, uTime * 0.10, 0.0));
            col = mix(vec3(0.44, 0.075, 0.035), vec3(0.96, 0.24, 0.05), conv * 0.62 + plume * 0.38);
            col *= shade;
            col += vec3(0.55, 0.20, 0.06) * clipRim;
          } else {
            // Lithospheric Crust Shell: basaltic & granitic structural wall right beneath surface
            float grain = octFbm3d(dir * 16.0);
            col = mix(vec3(0.14, 0.24, 0.36), vec3(0.28, 0.48, 0.68), grain);
            col *= shade;
            col += vec3(0.32, 0.66, 0.94) * clipRim * 0.92;
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side,
    });
  }

  /**
   * Builds the concentric Core, Mantle, and Crust cutaway shells plus the three orthogonal
   * local-plane cross-section caps (XY at z=0, YZ at x=0, XZ at y=0) inside EarthSceneEngine.
   */
  private buildCoreCutaway() {
    this.coreCutawayGroup.name = 'earth-core-cutaway';
    this.coreCutawayGroup.visible = false;

    const innerCoreR = EARTH_RADIUS * 0.218;
    const outerCoreR = EARTH_RADIUS * 0.538;
    const mantleR = EARTH_RADIUS * 0.942;
    const crustR = EARTH_RADIUS * 0.988;
    const capRadius = EARTH_RADIUS * 0.996;

    // 1. Solid Inner Core shell (protrudes intact inside the carved octant apex by default)
    const innerCoreGeo = new THREE.SphereGeometry(innerCoreR, 44, 32);
    const innerCoreMat = this.createOctantShellMaterial(
      'inner-core',
      innerCoreR,
      new THREE.Vector3(0.26, 0.26, 0.26),
      THREE.FrontSide,
    );
    const innerCoreMesh = new THREE.Mesh(innerCoreGeo, innerCoreMat);
    innerCoreMesh.name = 'cutaway-inner-core-shell';
    this.coreCutawayGroup.add(innerCoreMesh);

    // 2. Liquid Outer Core shell (stepped 90-degree octant bowl revealing the solid inner core)
    const outerCoreGeo = new THREE.SphereGeometry(outerCoreR, 48, 36);
    const outerCoreMat = this.createOctantShellMaterial(
      'outer-core',
      outerCoreR,
      new THREE.Vector3(0.092, 0.092, 0.092),
      THREE.DoubleSide,
    );
    const outerCoreMesh = new THREE.Mesh(outerCoreGeo, outerCoreMat);
    outerCoreMesh.name = 'cutaway-outer-core-shell';
    this.coreCutawayGroup.add(outerCoreMesh);

    // 3. Silicate Mantle shell (curved 3D mantle step framed between the outer core and Moho)
    const mantleGeo = new THREE.SphereGeometry(mantleR, 56, 40);
    const mantleMat = this.createOctantShellMaterial(
      'mantle',
      mantleR,
      new THREE.Vector3(0.034, 0.034, 0.034),
      THREE.DoubleSide,
    );
    const mantleMesh = new THREE.Mesh(mantleGeo, mantleMat);
    mantleMesh.name = 'cutaway-mantle-shell';
    this.coreCutawayGroup.add(mantleMesh);

    // 4. Lithospheric Crust shell (crisp structural inner crust lining flush under Earth's surface)
    const crustGeo = new THREE.SphereGeometry(crustR, 64, 44);
    const crustMat = this.createOctantShellMaterial(
      'crust',
      crustR,
      new THREE.Vector3(0.010, 0.010, 0.010),
      THREE.DoubleSide,
    );
    const crustMesh = new THREE.Mesh(crustGeo, crustMat);
    crustMesh.name = 'cutaway-crust-shell';
    this.coreCutawayGroup.add(crustMesh);

    // 5. Three opaque, Z-buffered orthogonal local-plane cross-section caps (XY, YZ, XZ)
    const capGeo = new THREE.RingGeometry(innerCoreR * 0.985, capRadius, 72, 1, 0, Math.PI / 2);
    const createPlaneCapMaterial = (planeShadeBias: number) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.earthUniforms.uTime,
          uSunDir: this.earthUniforms.uSunDir,
          uRadius: { value: capRadius },
          uPlaneBias: { value: planeShadeBias },
        },
        vertexShader: /* glsl */ `
          varying vec3 vCapLocalPos;
          varying vec3 vWorldNormal;
          void main() {
            vCapLocalPos = position;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uSunDir;
          uniform float uRadius;
          uniform float uPlaneBias;
          varying vec3 vCapLocalPos;
          varying vec3 vWorldNormal;
          ${GLSL_INTERIOR_NOISE_3D}

          void main() {
            float r = length(vCapLocalPos.xy) / uRadius;
            float conv = octFbm3d(vec3(vCapLocalPos.xy * 6.8, uTime * 0.14));

            vec3 col;
            if (r < 0.538) {
              // Liquid Outer Core radial cross-section
              float t = clamp((r - 0.218) / 0.320, 0.0, 1.0);
              float dynamo = octFbm3d(vec3(vCapLocalPos.xy * 11.5, uTime * 0.32));
              col = mix(vec3(1.44, 0.80, 0.16), vec3(0.98, 0.28, 0.04), t);
              col += vec3(0.28, 0.14, 0.02) * dynamo;
            } else if (r < 0.942) {
              // Silicate Mantle radial cross-section (lower -> transition -> upper mantle)
              float t = clamp((r - 0.538) / 0.404, 0.0, 1.0);
              float plume = octFbm3d(vec3(vCapLocalPos.xy * 8.4 + vec2(0.0, -uTime * 0.08), uTime * 0.06));
              vec3 lowerMantle = vec3(0.86, 0.18, 0.04);
              vec3 midMantle = vec3(0.62, 0.11, 0.045);
              vec3 upperMantle = vec3(0.36, 0.065, 0.045);
              col = t < 0.55
                ? mix(lowerMantle, midMantle, t / 0.55)
                : mix(midMantle, upperMantle, (t - 0.55) / 0.45);
              col *= (0.76 + 0.46 * (conv * 0.55 + plume * 0.45));
            } else {
              // Lithospheric Crust cross-section band
              float t = clamp((r - 0.942) / 0.058, 0.0, 1.0);
              col = mix(vec3(0.18, 0.32, 0.48), vec3(0.32, 0.60, 0.84), t);
            }

            // Concentric geophysical discontinuities (Gutenberg CMB, 660 km Transition, Moho)
            float cmb = exp(-pow((r - 0.538) / 0.0085, 2.0));
            float transition660 = exp(-pow((r - 0.892) / 0.006, 2.0));
            float moho = exp(-pow((r - 0.942) / 0.007, 2.0));
            col += vec3(0.48, 0.36, 0.16) * cmb;
            col += vec3(0.18, 0.08, 0.05) * transition660;
            col += vec3(0.24, 0.48, 0.68) * moho;

            // Directional shading per orthogonal local plane for crisp 3D depth separation
            float sunFace = abs(dot(normalize(vWorldNormal), normalize(uSunDir)));
            col *= uPlaneBias * (0.82 + 0.24 * sunFace);

            gl_FragColor = vec4(col, 1.0);
          }
        `,
        side: THREE.DoubleSide,
      });

    // Plane 1: XY plane (local z = 0, x >= 0, y >= 0)
    const capMatXY = createPlaneCapMaterial(1.02);
    const capXY = new THREE.Mesh(capGeo, capMatXY);
    capXY.name = 'cutaway-plane-xy';
    this.coreCutawayGroup.add(capXY);

    // Plane 2: YZ plane (local x = 0, y >= 0, z >= 0)
    const capMatYZ = createPlaneCapMaterial(0.92);
    const capYZ = new THREE.Mesh(capGeo, capMatYZ);
    capYZ.rotation.y = -Math.PI / 2;
    capYZ.name = 'cutaway-plane-yz';
    this.coreCutawayGroup.add(capYZ);

    // Plane 3: XZ plane (local y = 0, x >= 0, z >= 0)
    const capMatXZ = createPlaneCapMaterial(0.84);
    const capXZ = new THREE.Mesh(capGeo, capMatXZ);
    capXZ.rotation.x = Math.PI / 2;
    capXZ.name = 'cutaway-plane-xz';
    this.coreCutawayGroup.add(capXZ);

    this.coreCutawayCapMeshes = { xy: capXY, yz: capYZ, xz: capXZ };
    this.coreCutawayDisposables.push(
      innerCoreGeo,
      innerCoreMat,
      outerCoreGeo,
      outerCoreMat,
      mantleGeo,
      mantleMat,
      crustGeo,
      crustMat,
      capGeo,
      capMatXY,
      capMatYZ,
      capMatXZ,
    );

    this.earthGroup.add(this.coreCutawayGroup);
  }

  /**
   * Synchronizes per-shell stepped local clip planes and orthogonal cross-section cap orientations
   * whenever the selected 90-degree octant or local clip plane origin changes.
   */
  private syncOctantShellClipPlanes() {
    const octant = this.earthUniforms.uCutawayOctant.value;
    const planes = this.earthUniforms.uOctantClipPlanes.value;
    for (const entry of this.coreCutawayShellOffsets) {
      entry.clipPlanesUniform.value.set(
        entry.baseOffset.x * octant.x + planes.x,
        entry.baseOffset.y * octant.y + planes.y,
        entry.baseOffset.z * octant.z + planes.z,
      );
    }
    if (this.coreCutawayCapMeshes) {
      this.coreCutawayCapMeshes.xy.position.z = planes.z;
      this.coreCutawayCapMeshes.xy.scale.set(octant.x, octant.y, 1);

      this.coreCutawayCapMeshes.yz.position.x = planes.x;
      this.coreCutawayCapMeshes.yz.scale.set(octant.z, octant.y, 1);

      this.coreCutawayCapMeshes.xz.position.y = planes.y;
      this.coreCutawayCapMeshes.xz.scale.set(octant.x, octant.z, 1);
    }
  }

  /**
   * Selects which of the 8 90-degree octants (sx, sy, sz in {1, -1}) is excised by the
   * cutaway fragment shader, reorienting the core, mantle, crust shells and cross-section caps.
   */
  public setCutawayOctant(sx: 1 | -1, sy: 1 | -1, sz: 1 | -1) {
    if (this.disposed) return;
    this.earthUniforms.uCutawayOctant.value.set(sx, sy, sz);
    this.syncOctantShellClipPlanes();
    if (this.targetCutaway > 0.5) {
      this.focusCoreCutaway();
    }
  }

  /**
   * Updates the local octant clip plane coordinates (x, y, z) across Earth's surface,
   * atmosphere, clouds, cross-section caps, and concentric core/mantle/crust shells.
   */
  public setOctantClipPlanes(x: number, y: number, z: number) {
    if (this.disposed) return;
    this.earthUniforms.uOctantClipPlanes.value.set(x, y, z);
    this.syncOctantShellClipPlanes();
  }

  /**
   * Smoothly peels back or closes the 90-degree octant Core Cutaway shader uniforms
   * and synchronizes the internal concentric core, mantle, and crust shells visibility.
   */
  private updateCoreCutawayShader(dt: number) {
    this.earthUniforms.uCutaway.value = THREE.MathUtils.damp(
      this.earthUniforms.uCutaway.value,
      this.targetCutaway,
      4.6,
      dt,
    );
    const active = this.targetCutaway > 0.5 || this.earthUniforms.uCutaway.value > 0.005;
    this.earthUniforms.uCutawayEnabled.value = active ? 1.0 : 0.0;
    this.coreCutawayGroup.visible = active;
  }

  public setCoreCutaway(enabled: boolean) {
    if (this.disposed) return;
    this.targetCutaway = enabled ? 1.0 : 0.0;
    if (enabled) {
      this.earthUniforms.uCutawayEnabled.value = 1.0;
      this.coreCutawayGroup.visible = true;
      this.focusCoreCutaway();
    }
  }

  private buildDeepTime() {
    this.deepTimeRig = buildDeepTimeRig(EARTH_RADIUS);
    this.earthGroup.add(this.deepTimeRig.surfaceGroup);
    this.axialTiltGroup.add(this.deepTimeRig.orbitalGroup);
    for (const proxy of this.deepTimeRig.beaconHitProxies) {
      this.interactiveProxies.push(proxy);
    }
  }

  private buildGraticule() {
    const r = EARTH_RADIUS * 1.004;
    const regularMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    });
    const majorMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });

    for (let lat = -75; lat <= 75; lat += 15) {
      const pts: THREE.Vector3[] = [];
      const steps = 96;
      for (let i = 0; i <= steps; i++) {
        const lon = -180 + (i / steps) * 360;
        pts.push(latLonToVector3(lat, lon, r));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, lat === 0 ? majorMat : regularMat);
      this.graticuleGroup.add(line);
    }

    for (let lon = -180; lon < 180; lon += 15) {
      const pts: THREE.Vector3[] = [];
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const lat = -85 + (i / steps) * 170;
        pts.push(latLonToVector3(lat, lon, r));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, lon === 0 ? majorMat : regularMat);
      this.graticuleGroup.add(line);
    }

    this.earthGroup.add(this.graticuleGroup);
  }

  private buildMagneticField() {
    this.magneticFieldRig = buildMagneticFieldRig();
    this.earthGroup.add(this.magneticFieldRig.group);
  }

  private buildEarthquakeLayer() {
    const stem = new THREE.CylinderGeometry(0.0018, 0.0036, 1.0, 8);
    stem.translate(0, 0.5, 0);
    const tip = new THREE.OctahedronGeometry(0.011, 0);
    const baseRing = new THREE.RingGeometry(0.011, 0.017, 24);
    baseRing.rotateX(-Math.PI / 2);
    const waveRing = new THREE.RingGeometry(0.016, 0.021, 28);
    waveRing.rotateX(-Math.PI / 2);
    const proxy = new THREE.SphereGeometry(0.045, 10, 10);
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });

    this.earthquakeSharedGeos = { stem, tip, baseRing, waveRing, proxy, proxyMat };
    this.earthGroup.add(this.earthquakesGroup);
  }

  public updateEarthquakes(events: EarthquakeEvent[], referenceTimeMs = Date.now()) {
    if (this.disposed || !this.earthquakeSharedGeos) return;
    this.seismicReferenceTimeMs = referenceTimeMs;

    this.interactiveProxies = this.interactiveProxies.filter(
      (obj) => obj.userData.kind !== 'earthquake',
    );

    for (const entry of this.earthquakeNodes.values()) {
      entry.group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (
          mesh.isMesh &&
          mesh.material &&
          mesh.material !== this.earthquakeSharedGeos?.proxyMat
        ) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
      this.earthquakesGroup.remove(entry.group);
    }
    this.earthquakeNodes.clear();
    this.earthquakeMap.clear();

    const { stem, tip, baseRing, waveRing, proxy, proxyMat } = this.earthquakeSharedGeos;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      this.earthquakeMap.set(ev.id, ev);

      const magNorm = THREE.MathUtils.clamp((ev.magnitude - 2.4) / 4.6, 0, 1);
      const pinHeight = 0.024 + Math.pow(magNorm, 1.35) * 0.115;
      const headScale = 0.72 + Math.pow(magNorm, 1.15) * 1.35;
      const ringScale = 0.75 + Math.pow(magNorm, 1.2) * 1.85;
      const color = new THREE.Color(magnitudeColorHex(ev.magnitude));

      const nodeGroup = new THREE.Group();
      const surfacePos = latLonToVector3(ev.lat, ev.lon, EARTH_RADIUS * 1.004);
      nodeGroup.position.copy(surfacePos);
      nodeGroup.quaternion.setFromUnitVectors(_up, surfacePos.clone().normalize());

      const stemMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.78,
      });
      const stemMesh = new THREE.Mesh(stem, stemMat);
      stemMesh.scale.set(0.75 + magNorm * 0.85, pinHeight, 0.75 + magNorm * 0.85);
      nodeGroup.add(stemMesh);

      const tipMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.45 + magNorm * 0.7,
        roughness: 0.22,
        metalness: 0.12,
      });
      const tipMesh = new THREE.Mesh(tip, tipMat);
      tipMesh.position.y = pinHeight + 0.006 * headScale;
      tipMesh.scale.setScalar(headScale);
      nodeGroup.add(tipMesh);

      const baseMat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      });
      const baseRingMesh = new THREE.Mesh(baseRing, baseMat);
      baseRingMesh.position.y = 0.0025;
      baseRingMesh.scale.setScalar(ringScale);
      nodeGroup.add(baseRingMesh);

      const waveMat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      });
      const waveMesh = new THREE.Mesh(waveRing, waveMat);
      waveMesh.position.y = 0.0032;
      nodeGroup.add(waveMesh);

      const hitProxy = new THREE.Mesh(proxy, proxyMat);
      hitProxy.position.y = Math.max(0.025, pinHeight * 0.72);
      hitProxy.scale.setScalar(0.85 + magNorm * 0.55);
      hitProxy.layers.set(1);
      hitProxy.userData = { kind: 'earthquake', id: ev.id };
      nodeGroup.add(hitProxy);

      this.earthquakesGroup.add(nodeGroup);
      this.earthquakeNodes.set(ev.id, {
        group: nodeGroup,
        tip: tipMesh,
        waveRing: waveMesh,
        waveMat,
        phase: (i * 0.23) % 1,
        magScale: ringScale,
        hitProxy,
      });
      this.interactiveProxies.push(hitProxy);
    }

    this.syncSelectedEarthquakeHighlight();
  }

  private syncSelectedEarthquakeHighlight() {
    const selectedEqId =
      this.settings.selectedTarget?.kind === 'earthquake'
        ? this.settings.selectedTarget.id
        : null;
    for (const [id, entry] of this.earthquakeNodes.entries()) {
      const ev = this.earthquakeMap.get(id);
      if (!ev) continue;
      const magNorm = THREE.MathUtils.clamp((ev.magnitude - 2.4) / 4.6, 0, 1);
      const baseHeadScale = 0.72 + Math.pow(magNorm, 1.15) * 1.35;
      entry.tip.scale.setScalar(id === selectedEqId ? baseHeadScale * 1.5 : baseHeadScale);
    }
  }

  private buildStations() {
    const stemGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 0.036, 8);
    stemGeo.translate(0, 0.018, 0);

    const tipGeo = new THREE.SphereGeometry(0.0095, 12, 12);
    const ringGeo = new THREE.RingGeometry(0.012, 0.018, 20);
    ringGeo.rotateX(-Math.PI / 2);

    const proxyGeo = new THREE.SphereGeometry(0.042, 10, 10);
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });

    for (const station of STATIONS) {
      const colorHex = CATEGORY_COLORS[station.category];
      const color = new THREE.Color(colorHex);

      const nodeGroup = new THREE.Group();
      const surfacePos = latLonToVector3(station.lat, station.lon, EARTH_RADIUS * 1.003);
      nodeGroup.position.copy(surfacePos);

      const normal = surfacePos.clone().normalize();
      nodeGroup.quaternion.setFromUnitVectors(_up, normal);

      const stemMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.72,
      });
      const stem = new THREE.Mesh(stemGeo, stemMat);
      nodeGroup.add(stem);

      const tipMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.35,
        roughness: 0.25,
        metalness: 0.1,
      });
      const tip = new THREE.Mesh(tipGeo, tipMat);
      tip.position.y = 0.038;
      nodeGroup.add(tip);

      const ringMat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.003;
      nodeGroup.add(ring);

      const hitProxy = new THREE.Mesh(proxyGeo, proxyMat);
      hitProxy.position.y = 0.025;
      hitProxy.layers.set(1);
      hitProxy.userData = { kind: 'station', id: station.id };
      nodeGroup.add(hitProxy);

      this.stationsGroup.add(nodeGroup);
      this.stationNodes.set(station.id, { group: nodeGroup, ring, tip, hitProxy });
      this.interactiveProxies.push(hitProxy);
    }

    this.earthGroup.add(this.stationsGroup);
  }

  private buildGreatCircleArcs() {
    const stationMap = new Map(STATIONS.map((s) => [s.id, s]));
    const kindColors: Record<string, number> = {
      telemetry: 0x38bdf8,
      atmospheric: 0xa78bfa,
      oceanic: 0x2dd4bf,
    };

    for (const arc of DATA_ARCS) {
      const from = stationMap.get(arc.fromId);
      const to = stationMap.get(arc.toId);
      if (!from || !to) continue;

      const p0 = latLonToVector3(from.lat, from.lon, EARTH_RADIUS * 1.006);
      const p2 = latLonToVector3(to.lat, to.lon, EARTH_RADIUS * 1.006);
      const chordDist = p0.distanceTo(p2);
      const mid = p0
        .clone()
        .add(p2)
        .multiplyScalar(0.5)
        .normalize()
        .multiplyScalar(EARTH_RADIUS * (1.06 + chordDist * 0.16));

      const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
      this.arcCurves.push(curve);

      const pts = curve.getPoints(44);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: kindColors[arc.kind] ?? 0x38bdf8,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      this.arcsGroup.add(line);
    }

    const packetCount = this.arcCurves.length * 2;
    const packetGeo = new THREE.SphereGeometry(0.0065, 8, 8);
    const packetMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.92,
    });
    this.packetMesh = new THREE.InstancedMesh(packetGeo, packetMat, packetCount);
    this.packetMesh.frustumCulled = false;

    for (let i = 0; i < packetCount; i++) {
      this.packetPhases.push((i % 2) * 0.5 + ((i * 0.13) % 1));
      this.packetSpeeds.push(0.16 + ((i * 37) % 10) * 0.011);
    }
    this.arcsGroup.add(this.packetMesh);
    this.earthGroup.add(this.arcsGroup);
  }

  private buildSatellites() {
    for (const sat of SATELLITES) {
      const raanRad = THREE.MathUtils.degToRad(sat.raanDeg);
      const incRad = THREE.MathUtils.degToRad(sat.inclinationDeg);
      const qRaan = new THREE.Quaternion().setFromAxisAngle(_up, raanRad);
      const qInc = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        incRad,
      );
      const orbitPlaneQuat = qRaan.multiply(qInc);

      const ringPts: THREE.Vector3[] = [];
      const segs = 96;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const p = new THREE.Vector3(
          Math.cos(a) * sat.visualRadius,
          0,
          Math.sin(a) * sat.visualRadius,
        ).applyQuaternion(orbitPlaneQuat);
        ringPts.push(p);
      }
      const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
      const ringMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(sat.accentColor),
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      });
      const orbitLine = new THREE.Line(ringGeo, ringMat);
      this.satellitesGroup.add(orbitLine);

      const { group, hitProxy } = buildSatelliteMesh(sat);
      this.satellitesGroup.add(group);
      this.interactiveProxies.push(hitProxy);

      this.satEntries.push({
        config: sat,
        group,
        orbitPlaneQuat,
        angle: sat.initialPhaseRad,
        hitProxy,
      });
    }

    this.scene.add(this.satellitesGroup);
  }

  private buildFocusPin() {
    const cyan = new THREE.Color('#22d3ee');

    const stemGeo = new THREE.CylinderGeometry(0.0026, 0.0026, 0.052, 10);
    stemGeo.translate(0, 0.026, 0);
    const stem = new THREE.Mesh(
      stemGeo,
      new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0.9 }),
    );
    this.focusPinGroup.add(stem);

    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 14, 14),
      new THREE.MeshStandardMaterial({
        color: cyan,
        emissive: cyan,
        emissiveIntensity: 1.7,
        roughness: 0.2,
        metalness: 0.1,
      }),
    );
    tip.position.y = 0.054;
    this.focusPinGroup.add(tip);

    const innerRingGeo = new THREE.RingGeometry(0.014, 0.021, 28);
    innerRingGeo.rotateX(-Math.PI / 2);
    const innerRing = new THREE.Mesh(
      innerRingGeo,
      new THREE.MeshBasicMaterial({
        color: cyan,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    innerRing.position.y = 0.004;
    this.focusPinGroup.add(innerRing);

    const outerRingGeo = new THREE.RingGeometry(0.032, 0.036, 32);
    outerRingGeo.rotateX(-Math.PI / 2);
    const outerRing = new THREE.Mesh(
      outerRingGeo,
      new THREE.MeshBasicMaterial({
        color: cyan,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    outerRing.position.y = 0.004;
    this.focusPinGroup.add(outerRing);

    this.focusPinGroup.visible = false;
    this.earthGroup.add(this.focusPinGroup);
  }

  private updateSunDirection(hourUtc: number) {
    const subSolarLon = (12 - hourUtc) * 15;
    const declinationDeg = this.settings.appMode === 'deep-time' ? 12.0 : -19.8;
    latLonToVector3(declinationDeg, subSolarLon, 1.0, _vecA);

    _vecA.applyAxisAngle(_up, this.earthGroup.rotation.y).normalize();

    this.earthUniforms.uSunDir.value.copy(_vecA);
    this.sunLight.position.copy(_vecA).multiplyScalar(12);
  }

  public applySettings(next: SceneSettings) {
    const prevMode = this.settings.dataMode;
    const prevAppMode = this.settings.appMode;
    const prevEra = this.settings.deepTimeEra;
    const prevCutaway = this.settings.coreCutaway;

    this.settings = { ...next, sandbox: { ...next.sandbox } };

    const isDeepTime = next.appMode === 'deep-time';

    // In Deep Time mode, dim live modern telemetry layers so geological storytelling shines
    this.cloudMesh.visible = isDeepTime ? true : next.showClouds;
    this.cirrusMesh.visible = isDeepTime ? true : next.showClouds;
    this.graticuleGroup.visible = !isDeepTime && next.showGraticule;
    this.magneticFieldRig.group.visible = !isDeepTime && next.showMagneticField;
    this.earthquakesGroup.visible = !isDeepTime && next.showEarthquakes;
    this.stationsGroup.visible = !isDeepTime && next.showStations;
    this.arcsGroup.visible = !isDeepTime && next.showArcs;
    this.satellitesGroup.visible = !isDeepTime && next.showSatellites;

    if (isDeepTime || !next.showMagneticField) {
      this.magneticFieldRig.hideCursorProbe();
      this.callbacks.onMagneticProbe(null);
    }

    // Deep Time rig & animated 90-degree Core Cutaway target
    this.deepTimeRig.setActiveEra(isDeepTime, next.deepTimeEra);
    const cutawayActive = isDeepTime && next.coreCutaway;
    this.targetCutaway = cutawayActive ? 1.0 : 0.0;
    if (cutawayActive) {
      this.coreCutawayGroup.visible = true;
    }

    if (isDeepTime && next.coreCutaway && !prevCutaway) {
      this.focusCoreCutaway();
    }

    // Trigger chapter opening animation when entering Deep Time or switching chapters
    if (isDeepTime && (prevAppMode !== 'deep-time' || prevEra !== next.deepTimeEra)) {
      const chapter = getDeepTimeChapter(next.deepTimeEra);
      if (next.deepTimeEra === 'accretion') {
        this.deepTimeRig.triggerAction('theia-impact');
      }
      if (!next.coreCutaway) {
        this.flyToCoordinates(
          chapter.cameraFocus.lat,
          chapter.cameraFocus.lon,
          chapter.cameraFocus.distance,
        );
      }
    }

    // City lights intensity (disabled during ancient pre-human Deep Time eras)
    const chapter = getDeepTimeChapter(next.deepTimeEra);
    const allowCities = isDeepTime ? chapter.shader.allowCityLights : next.showCityLights;
    this.earthUniforms.uCityLightsIntensity.value = allowCities ? 1.0 : 0.0;

    if (isDeepTime || next.dataMode === 'natural') {
      this.targetOverlayMix = 0.0;
    } else {
      this.targetOverlayMix = 0.88;
      if (next.dataMode !== prevMode || this.earthUniforms.uOverlayMap.value === null) {
        if (next.dataMode === 'precipitation') {
          this.earthUniforms.uOverlayMap.value = this.textures.precipitationMap;
        } else if (next.dataMode === 'thermal') {
          this.earthUniforms.uOverlayMap.value = this.textures.thermalMap;
        } else if (next.dataMode === 'co2') {
          this.earthUniforms.uOverlayMap.value = this.textures.co2Map;
        } else if (next.dataMode === 'tectonic') {
          this.earthUniforms.uOverlayMap.value = this.textures.tectonicMap;
        }
      }
    }

    // Highlight selected station ring
    const selectedStationId =
      next.selectedTarget?.kind === 'station' ? next.selectedTarget.id : null;
    for (const [id, entry] of this.stationNodes.entries()) {
      const isSelected = id === selectedStationId;
      const s = isSelected ? 1.75 : 1.0;
      entry.ring.scale.set(s, s, s);
      entry.tip.scale.setScalar(isSelected ? 1.45 : 1.0);
    }

    this.syncSelectedEarthquakeHighlight();

    // Position and show 3D focus pin when a global city/location target is selected
    if (!isDeepTime && next.selectedTarget?.kind === 'location') {
      const { lat, lon } = next.selectedTarget.location;
      const pos = latLonToVector3(lat, lon, EARTH_RADIUS * 1.003);
      this.focusPinGroup.position.copy(pos);
      this.focusPinGroup.quaternion.setFromUnitVectors(_up, pos.clone().normalize());
      this.focusPinGroup.visible = true;
    } else {
      this.focusPinGroup.visible = false;
    }

    this.updateSunDirection(next.solarHourUtc);
  }

  public triggerDeepTimeAction(action: StoryBeaconAction) {
    if (this.disposed) return;
    this.deepTimeRig.triggerAction(action);
  }

  public focusCoreCutaway() {
    // Aim camera directly into the center diagonal of the currently selected 90-degree octant
    const oct = this.earthUniforms.uCutawayOctant.value;
    _vecA.set(oct.x, oct.y, oct.z).normalize();
    const { lat, lon } = vector3ToLatLon(_vecA);
    this.flyToCoordinates(lat, lon, 2.38);
  }

  public updateWeatherData(samples: WeatherSample[]) {
    if (this.disposed || !this.textures) return;
    this.textures.updateWeatherTextures(samples);
  }

  public flyToPreset(presetId: CameraPresetId) {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.flyToCoordinates(preset.lat, preset.lon, preset.distance);
  }

  public flyToCoordinates(lat: number, lon: number, distance = 2.15) {
    this.trackingSatelliteId = null;
    this.axialTiltGroup.updateMatrixWorld(true);
    const targetPos = latLonToVector3(lat, lon, distance);
    targetPos.applyQuaternion(this.earthGroup.getWorldQuaternion(_quat));
    this.cameraFlyTarget = targetPos;
  }

  public flyToStation(stationId: string) {
    const station = STATIONS.find((s) => s.id === stationId);
    if (!station) return;
    this.flyToCoordinates(station.lat, station.lon, 2.22);
  }

  public flyToSatellite(satId: string) {
    const entry = this.satEntries.find((e) => e.config.id === satId);
    if (!entry) return;
    this.trackingSatelliteId = satId;
    this.cameraFlyTarget = entry.group.position.clone().normalize().multiplyScalar(2.45);
  }

  private handleUserOrbitStart = () => {
    this.cameraFlyTarget = null;
    this.trackingSatelliteId = null;
  };

  private handleResize = () => {
    if (this.disposed || !this.renderer) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(width, height);
    }
  };

  private handleContextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
  };

  private handleContextRestored = () => {
    if (!this.disposed) {
      this.lastTimeMs = performance.now();
      this.tick();
    }
  };

  private updatePointerNdc(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handlePointerDown = (event: PointerEvent) => {
    this.pointerDownPos.x = event.clientX;
    this.pointerDownPos.y = event.clientY;
  };

  private getActiveInteractiveProxies(): THREE.Object3D[] {
    const isDeepTime = this.settings.appMode === 'deep-time';
    return this.interactiveProxies.filter((obj) => {
      const kind = obj.userData.kind;
      if (isDeepTime) {
        return kind === 'beacon' && obj.userData.eraId === this.settings.deepTimeEra;
      }
      if (kind === 'beacon') return false;
      if (kind === 'station' && !this.settings.showStations) return false;
      if (kind === 'satellite' && !this.settings.showSatellites) return false;
      if (kind === 'earthquake' && !this.settings.showEarthquakes) return false;
      return true;
    });
  }

  private handlePointerUp = (event: PointerEvent) => {
    const dx = event.clientX - this.pointerDownPos.x;
    const dy = event.clientY - this.pointerDownPos.y;
    if (dx * dx + dy * dy > 36) return; // Dragged to orbit, not a click

    this.updatePointerNdc(event);

    // If a Deep Time Spatial Field Check is armed, prioritize globe surface click coordinate validation
    if (this.settings.appMode === 'deep-time' && this.settings.fieldCheckActive) {
      this.raycaster.layers.set(0);
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const earthHits = this.raycaster.intersectObject(this.earthMesh, false);
      if (earthHits.length > 0) {
        _vecC.copy(earthHits[0].point);
        this.earthGroup.worldToLocal(_vecC);
        const coords = vector3ToLatLon(_vecC);
        this.callbacks.onGlobeClickCoords?.(coords);
        return;
      }
    }

    this.raycaster.layers.set(1);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const activeProxies = this.getActiveInteractiveProxies();
    const hits = this.raycaster.intersectObjects(activeProxies, false);
    if (hits.length > 0) {
      const hitData = hits[0].object.userData as {
        kind: 'station' | 'satellite' | 'earthquake' | 'beacon';
        id: string;
      };
      if (hitData.kind === 'beacon') {
        const beacon = this.deepTimeRig.beaconMap.get(hitData.id);
        if (beacon) {
          this.deepTimeRig.triggerAction(beacon.action);
          this.flyToCoordinates(beacon.lat, beacon.lon, 2.38);
          this.callbacks.onSelectBeacon?.(beacon);
        }
        return;
      }
      if (hitData.kind === 'station') {
        this.callbacks.onSelectTarget({ kind: 'station', id: hitData.id });
        this.flyToStation(hitData.id);
      } else if (hitData.kind === 'satellite') {
        this.callbacks.onSelectTarget({ kind: 'satellite', id: hitData.id });
        this.flyToSatellite(hitData.id);
      } else if (hitData.kind === 'earthquake') {
        const eq = this.earthquakeMap.get(hitData.id);
        if (eq) {
          this.callbacks.onSelectTarget({ kind: 'earthquake', id: eq.id, event: eq });
          this.flyToCoordinates(eq.lat, eq.lon, 2.08);
        }
      }
      return;
    }
  };

  private handlePointerMove = (event: PointerEvent) => {
    const now = performance.now();
    if (now - this.lastPointerMoveMs < 45) return;
    this.lastPointerMoveMs = now;

    this.updatePointerNdc(event);

    // 1. Check interactive stations, satellites, earthquakes, or Deep Time story beacons on layer 1
    this.raycaster.layers.set(1);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const activeProxies = this.getActiveInteractiveProxies();
    const proxyHits = this.raycaster.intersectObjects(activeProxies, false);
    if (proxyHits.length > 0) {
      const hitObj = proxyHits[0].object;
      const { kind, id } = hitObj.userData as {
        kind: 'station' | 'satellite' | 'earthquake' | 'beacon';
        id: string;
      };
      this.renderer.domElement.style.cursor = this.settings.fieldCheckActive
        ? 'crosshair'
        : 'pointer';

      hitObj.getWorldPosition(_vecB);
      _vecB.project(this.camera);
      const rect = this.renderer.domElement.getBoundingClientRect();
      const sx = ((_vecB.x + 1) / 2) * rect.width;
      const sy = ((-_vecB.y + 1) / 2) * rect.height;

      if (kind === 'beacon') {
        const b = this.deepTimeRig.beaconMap.get(id);
        if (b) {
          this.callbacks.onHoverTarget({
            kind,
            id,
            label: b.name,
            sublabel: `${b.ageLabel} · ${b.region}`,
            details: `${b.metricLabel}: ${b.metricValue} · Click to inspect`,
            accentColor: b.accentColor,
            x: sx,
            y: sy,
          });
        }
      } else if (kind === 'station') {
        const st = STATIONS.find((s) => s.id === id);
        if (st) {
          this.callbacks.onHoverTarget({
            kind,
            id,
            label: st.name,
            sublabel: `${st.primaryMetricLabel}: ${st.primaryMetricValue} ${st.primaryMetricUnit}`,
            accentColor: CATEGORY_COLORS[st.category],
            x: sx,
            y: sy,
          });
        }
      } else if (kind === 'satellite') {
        const sat = SATELLITES.find((s) => s.id === id);
        if (sat) {
          this.callbacks.onHoverTarget({
            kind,
            id,
            label: sat.name,
            sublabel: `${sat.orbitType} · ${sat.altitudeKm.toLocaleString()} km`,
            accentColor: sat.accentColor,
            x: sx,
            y: sy,
          });
        }
      } else if (kind === 'earthquake') {
        const eq = this.earthquakeMap.get(id);
        if (eq) {
          const tsunamiTag = eq.tsunami ? ' · Tsunami Watch' : '';
          this.callbacks.onHoverTarget({
            kind,
            id,
            label: `M ${eq.magnitude.toFixed(1)} ${eq.severity}${tsunamiTag}`,
            sublabel: eq.place,
            details: `Depth ${eq.depthKm.toFixed(1)} km · ${formatRelativeTime(eq.timeMs, this.seismicReferenceTimeMs)} (${formatEventUtcTime(eq.timeMs)})`,
            accentColor: magnitudeColorHex(eq.magnitude),
            x: sx,
            y: sy,
          });
        }
      }
    } else {
      this.renderer.domElement.style.cursor =
        this.settings.appMode === 'deep-time' && this.settings.fieldCheckActive
          ? 'crosshair'
          : 'grab';
      this.callbacks.onHoverTarget(null);
    }

    // 2. Raycast Earth sphere on layer 0 for live surface latitude/longitude & geomagnetic vector probe
    this.raycaster.layers.set(0);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const earthHits = this.raycaster.intersectObject(this.earthMesh, false);
    if (earthHits.length > 0) {
      _vecC.copy(earthHits[0].point);
      this.earthGroup.worldToLocal(_vecC);
      const coords = vector3ToLatLon(_vecC);
      this.callbacks.onCursorCoords(coords);

      if (this.settings.appMode === 'telemetry' && this.settings.showMagneticField) {
        const sample = this.magneticFieldRig.setCursorProbe(coords.lat, coords.lon);
        this.callbacks.onMagneticProbe({
          lat: coords.lat,
          lon: coords.lon,
          intensityUt: sample.intensityUt,
          inclinationDeg: sample.inclinationDeg,
          declinationDeg: sample.declinationDeg,
        });
      }
    } else {
      this.callbacks.onCursorCoords(null);
      if (this.settings.appMode === 'telemetry' && this.settings.showMagneticField) {
        this.magneticFieldRig.hideCursorProbe();
        this.callbacks.onMagneticProbe(null);
      }
    }
  };

  private handlePointerLeave = () => {
    this.callbacks.onHoverTarget(null);
    this.callbacks.onCursorCoords(null);
    if (this.magneticFieldRig) {
      this.magneticFieldRig.hideCursorProbe();
      this.callbacks.onMagneticProbe(null);
    }
  };

  private afterDraw(cb: () => void) {
    if (this.disposed) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = () => {
    if (this.disposed) return;

    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTimeMs) / 1000);
    this.lastTimeMs = now;
    this.elapsedSec += dt;
    this.earthUniforms.uTime.value = this.elapsedSec;

    const isDeepTime = this.settings.appMode === 'deep-time';
    const chapter = getDeepTimeChapter(this.settings.deepTimeEra);

    // 1. Axial tilt obliquity interpolation (tilts Earth's spin axis in Deep Time sandbox)
    const targetTiltRad = isDeepTime
      ? -THREE.MathUtils.degToRad(this.settings.sandbox.axialTiltDeg - 23.4)
      : 0.0;
    this.axialTiltGroup.rotation.z = THREE.MathUtils.damp(
      this.axialTiltGroup.rotation.z,
      targetTiltRad,
      4.5,
      dt,
    );

    // 2. Gentle globe auto-rotation & dual-layer parallax atmospheric cloud drift
    const shouldSpin =
      this.settings.autoRotate &&
      !this.cameraFlyTarget &&
      !this.trackingSatelliteId &&
      !(isDeepTime && (this.settings.coreCutaway || this.settings.fieldCheckActive));
    if (shouldSpin) {
      this.earthGroup.rotation.y += dt * (isDeepTime ? 0.032 : 0.042);
      this.updateSunDirection(this.settings.solarHourUtc);
    }

    if (this.cloudMesh.visible) {
      this.cloudMesh.rotation.y += dt * 0.011;
      this.cirrusMesh.rotation.y += dt * 0.017;
      // Sync primary cloud longitude rotation to projected cloud drop-shadow sampler
      const rotNorm = (this.cloudMesh.rotation.y / (Math.PI * 2)) % 1;
      this.earthUniforms.uCloudRotOffset.value = rotNorm < 0 ? rotNorm + 1 : rotNorm;
    }

    // 2b. Animate 90-degree octant Core Cutaway peel-back shader uniform
    this.updateCoreCutawayShader(dt);

    // 3. Update Deep Time 3D rig (Theia, bombardment, stromatolites, Pangaea plates, Chicxulub)
    const { chicxulubAshPulse } = this.deepTimeRig.update({
      dt,
      elapsedSec: this.elapsedSec,
      active: isDeepTime,
      eraId: this.settings.deepTimeEra,
      driftProgress: this.settings.sandbox.driftProgress,
      lunarDistanceRe: this.settings.sandbox.lunarDistanceRe,
      riftMeltProgress: this.settings.sandbox.riftMeltProgress,
    });

    // 4. Smoothly damp Deep Time & Sandbox shader uniforms
    const co2Norm = isDeepTime
      ? THREE.MathUtils.clamp((Math.log(Math.max(0.2, this.settings.sandbox.co2Multiplier)) + 1.61) / 3.92, 0, 1)
      : 0;
    const co2IcePenalty = isDeepTime && this.settings.deepTimeEra === 'snowball'
      ? THREE.MathUtils.clamp((this.settings.sandbox.co2Multiplier - 1.0) / 8.0, 0, 0.55)
      : 0;

    const targetMagma = isDeepTime ? chapter.shader.magmaFactor : 0;
    const targetIce = isDeepTime ? Math.max(0, chapter.shader.iceCoverage - co2IcePenalty) : 0;
    const targetRift = isDeepTime ? this.settings.sandbox.riftMeltProgress : 0;
    const targetOceanStrength = isDeepTime ? chapter.shader.oceanTintStrength : 0;
    const targetAtmoHue = isDeepTime
      ? THREE.MathUtils.clamp(chapter.shader.atmosphereHue + co2Norm * 0.16, 0, 1)
      : 0;
    const targetAncientMix = isDeepTime ? chapter.shader.ancientSurfaceMix : 0;
    const targetAsh = isDeepTime
      ? Math.min(1, chapter.shader.ashFactor + chicxulubAshPulse)
      : 0;
    const targetOx = isDeepTime ? chapter.shader.oxidationFactor : 0;
    const targetCo2Haze = isDeepTime ? co2Norm * 0.72 : 0;

    this.earthUniforms.uMagmaFactor.value = THREE.MathUtils.damp(
      this.earthUniforms.uMagmaFactor.value,
      targetMagma,
      3.8,
      dt,
    );
    this.earthUniforms.uIceCoverage.value = THREE.MathUtils.damp(
      this.earthUniforms.uIceCoverage.value,
      targetIce,
      3.8,
      dt,
    );
    this.earthUniforms.uRiftMelt.value = THREE.MathUtils.damp(
      this.earthUniforms.uRiftMelt.value,
      targetRift,
      4.5,
      dt,
    );
    this.earthUniforms.uOceanTintStrength.value = THREE.MathUtils.damp(
      this.earthUniforms.uOceanTintStrength.value,
      targetOceanStrength,
      3.8,
      dt,
    );
    _colorTarget.setRGB(
      chapter.shader.oceanTintRgb[0],
      chapter.shader.oceanTintRgb[1],
      chapter.shader.oceanTintRgb[2],
    );
    this.earthUniforms.uOceanTintRgb.value.lerp(_colorTarget, 1 - Math.exp(-3.8 * dt));

    this.earthUniforms.uAtmosphereHue.value = THREE.MathUtils.damp(
      this.earthUniforms.uAtmosphereHue.value,
      targetAtmoHue,
      3.6,
      dt,
    );
    this.earthUniforms.uAncientSurfaceMix.value = THREE.MathUtils.damp(
      this.earthUniforms.uAncientSurfaceMix.value,
      targetAncientMix,
      3.8,
      dt,
    );
    this.earthUniforms.uAshFactor.value = THREE.MathUtils.damp(
      this.earthUniforms.uAshFactor.value,
      targetAsh,
      3.2,
      dt,
    );
    this.earthUniforms.uOxidationFactor.value = THREE.MathUtils.damp(
      this.earthUniforms.uOxidationFactor.value,
      targetOx,
      3.8,
      dt,
    );
    this.earthUniforms.uCo2Haze.value = THREE.MathUtils.damp(
      this.earthUniforms.uCo2Haze.value,
      targetCo2Haze,
      4.0,
      dt,
    );

    // 5. Dual-layer cloud opacity & projected cloud shadow strength
    const desiredCloudOpacity = isDeepTime
      ? Math.min(0.92, chapter.shader.cloudScale + chicxulubAshPulse * 0.45)
      : this.settings.dataMode === 'natural'
        ? 0.78
        : this.settings.dataMode === 'precipitation'
          ? 0.36
          : 0.16;
    const desiredCirrusOpacity = isDeepTime
      ? Math.min(0.55, chapter.shader.cloudScale * 0.45)
      : this.settings.dataMode === 'natural'
        ? 0.36
        : 0.12;

    this.cloudMaterial.uniforms.uOpacity.value = THREE.MathUtils.damp(
      this.cloudMaterial.uniforms.uOpacity.value,
      desiredCloudOpacity,
      4.5,
      dt,
    );
    this.cirrusMaterial.uniforms.uOpacity.value = THREE.MathUtils.damp(
      this.cirrusMaterial.uniforms.uOpacity.value,
      desiredCirrusOpacity,
      4.5,
      dt,
    );
    const desiredShadowStrength =
      this.cloudMesh.visible && !isDeepTime
        ? this.settings.dataMode === 'natural'
          ? 0.42
          : 0.14
        : isDeepTime
          ? chapter.shader.cloudScale * 0.34
          : 0.0;
    this.earthUniforms.uCloudShadowStrength.value = THREE.MathUtils.damp(
      this.earthUniforms.uCloudShadowStrength.value,
      desiredShadowStrength,
      4.5,
      dt,
    );

    // 6. Smoothly crossfade data overlay mix in Earth shader
    this.earthUniforms.uOverlayMix.value = THREE.MathUtils.damp(
      this.earthUniforms.uOverlayMix.value,
      this.targetOverlayMix,
      5.5,
      dt,
    );

    // 7. Optional continuous solar time advancement
    if (this.settings.solarAutoAdvance && !isDeepTime) {
      this.settings.solarHourUtc = (this.settings.solarHourUtc + dt * 0.85) % 24;
      this.updateSunDirection(this.settings.solarHourUtc);
      if (now - this.lastSolarEmitMs > 140) {
        this.lastSolarEmitMs = now;
        this.callbacks.onSolarHourTick(this.settings.solarHourUtc);
      }
    }

    // 8. Telemetry Animations (skipped when in Deep Time mode)
    if (!isDeepTime) {
      if (this.settings.showArcs && this.arcCurves.length > 0) {
        for (let i = 0; i < this.packetPhases.length; i++) {
          this.packetPhases[i] = (this.packetPhases[i] + dt * this.packetSpeeds[i]) % 1;
          const curve = this.arcCurves[Math.floor(i / 2)];
          curve.getPoint(this.packetPhases[i], _vecA);
          const pulseScale = 0.65 + Math.sin(this.packetPhases[i] * Math.PI) * 0.6;
          _scale.setScalar(pulseScale);
          _quat.identity();
          _mat4.compose(_vecA, _quat, _scale);
          this.packetMesh.setMatrixAt(i, _mat4);
        }
        this.packetMesh.instanceMatrix.needsUpdate = true;
      }

      if (this.settings.showMagneticField) {
        this.magneticFieldRig.update(dt);
      }

      if (this.settings.showEarthquakes && this.earthquakeNodes.size > 0) {
        for (const entry of this.earthquakeNodes.values()) {
          entry.phase = (entry.phase + dt * 0.48) % 1;
          const expand = entry.magScale * (1.0 + entry.phase * 2.15);
          entry.waveRing.scale.set(expand, expand, expand);
          entry.waveMat.opacity = (1 - entry.phase) * 0.62;
        }
      }

      const shouldEmitSatPos = now - this.lastSatPosEmitMs > 280;
      const livePositions: SatelliteLivePos[] = [];
      for (const sat of this.satEntries) {
        sat.angle = (sat.angle + dt * sat.config.angularSpeedRad) % (Math.PI * 2);
        const r = sat.config.visualRadius;
        _vecA.set(Math.cos(sat.angle) * r, 0, Math.sin(sat.angle) * r);
        _vecA.applyQuaternion(sat.orbitPlaneQuat);
        sat.group.position.copy(_vecA);
        sat.group.lookAt(0, 0, 0);

        if (this.trackingSatelliteId === sat.config.id) {
          _vecB.copy(_vecA).normalize().multiplyScalar(2.4);
          if (!this.cameraFlyTarget) {
            this.cameraFlyTarget = _vecB.clone();
          } else {
            this.cameraFlyTarget.copy(_vecB);
          }
        }

        if (shouldEmitSatPos) {
          _vecC.copy(_vecA);
          this.earthGroup.worldToLocal(_vecC);
          const ll = vector3ToLatLon(_vecC);
          livePositions.push({ id: sat.config.id, lat: ll.lat, lon: ll.lon });
        }
      }
      if (shouldEmitSatPos) {
        this.lastSatPosEmitMs = now;
        this.callbacks.onSatellitePositions(livePositions);
      }
    }

    // 9. Smooth damped spherical camera fly-to
    if (this.cameraFlyTarget) {
      const currentDist = this.camera.position.length();
      const targetDist = this.cameraFlyTarget.length();
      const nextDist = THREE.MathUtils.damp(currentDist, targetDist, 5.0, dt);

      _vecA.copy(this.camera.position).normalize();
      _vecB.copy(this.cameraFlyTarget).normalize();
      const alpha = 1 - Math.exp(-5.0 * dt);
      _vecA.lerp(_vecB, alpha).normalize().multiplyScalar(nextDist);
      this.camera.position.copy(_vecA);

      if (
        !this.trackingSatelliteId &&
        this.camera.position.distanceTo(this.cameraFlyTarget) < 0.015
      ) {
        this.cameraFlyTarget = null;
      }
    }

    this.controls.update();

    // 10. Dynamic zoom-responsive atmospheric limb & calibrated bloom
    const camDist = this.camera.position.length();
    const targetZoomFactor = THREE.MathUtils.clamp(
      (3.05 - camDist) / (3.05 - 1.32),
      0,
      1,
    );
    this.earthUniforms.uZoomFactor.value = THREE.MathUtils.damp(
      this.earthUniforms.uZoomFactor.value,
      targetZoomFactor,
      6.0,
      dt,
    );

    if (this.bloomPass) {
      const z = this.earthUniforms.uZoomFactor.value;
      const magmaBoost = this.earthUniforms.uMagmaFactor.value * 0.22;
      const coreBoost = this.earthUniforms.uCutaway.value * 0.14;
      this.bloomPass.strength = 0.23 + z * 0.24 + magmaBoost + coreBoost;
      this.bloomPass.radius = 0.42 + z * 0.2;
      this.bloomPass.threshold = 0.78 - magmaBoost * 0.18 - coreBoost * 0.12;
    }

    if (this.composer && !this.isSoftwareGl) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.renderer) {
      const canvas = this.renderer.domElement;
      canvas.removeEventListener('pointerdown', this.handlePointerDown);
      canvas.removeEventListener('pointerup', this.handlePointerUp);
      canvas.removeEventListener('pointermove', this.handlePointerMove);
      canvas.removeEventListener('pointerleave', this.handlePointerLeave);
      canvas.removeEventListener('webglcontextlost', this.handleContextLost);
      canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    }

    if (this.controls) {
      this.controls.removeEventListener('start', this.handleUserOrbitStart);
      this.controls.dispose();
    }

    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloomPass = null;
    }

    if (this.textures) {
      this.textures.dispose();
    }
    if (this.deepSpaceBackdrop) {
      this.deepSpaceBackdrop.dispose();
    }
    for (const item of this.coreCutawayDisposables) {
      item.dispose();
    }
    this.coreCutawayDisposables = [];
    this.coreCutawayShellOffsets = [];
    this.coreCutawayCapMeshes = null;
    if (this.deepTimeRig) {
      this.deepTimeRig.dispose();
    }
    disposeSharedSatelliteAssets();

    if (this.earthquakeSharedGeos) {
      this.earthquakeSharedGeos.stem.dispose();
      this.earthquakeSharedGeos.tip.dispose();
      this.earthquakeSharedGeos.baseRing.dispose();
      this.earthquakeSharedGeos.waveRing.dispose();
      this.earthquakeSharedGeos.proxy.dispose();
      this.earthquakeSharedGeos.proxyMat.dispose();
      this.earthquakeSharedGeos = null;
    }

    if (this.envRT) {
      this.envRT.dispose();
      this.envRT = null;
    }

    if (this.scene) {
      this.scene.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) {
          (obj as THREE.Mesh).geometry.dispose();
        }
        const mat = (obj as THREE.Mesh).material;
        if (mat) {
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose());
          } else {
            mat.dispose();
          }
        }
      });
    }

    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
  }
}
