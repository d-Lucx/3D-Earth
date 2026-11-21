import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
} from '../data/earthData';
import { createEarthTextures, type EarthTextureBundle } from './earthTextures';
import { buildSatelliteMesh, disposeSharedSatelliteAssets } from './satelliteBuilder';

export interface SceneSettings {
  dataMode: DataLayerMode;
  showClouds: boolean;
  showCityLights: boolean;
  showStations: boolean;
  showSatellites: boolean;
  showArcs: boolean;
  showGraticule: boolean;
  autoRotate: boolean;
  solarHourUtc: number;
  solarAutoAdvance: boolean;
  selectedTarget: { kind: 'station' | 'satellite'; id: string } | null;
}

export interface HoverInfo {
  kind: 'station' | 'satellite';
  id: string;
  label: string;
  sublabel: string;
  x: number;
  y: number;
}

export interface SatelliteLivePos {
  id: string;
  lat: number;
  lon: number;
}

export interface SceneCallbacks {
  onSelectTarget: (target: { kind: 'station' | 'satellite'; id: string } | null) => void;
  onHoverTarget: (hover: HoverInfo | null) => void;
  onCursorCoords: (coords: { lat: number; lon: number } | null) => void;
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
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private textures!: EarthTextureBundle;
  private envRT: THREE.WebGLRenderTarget | null = null;

  // Scene hierarchy
  private earthGroup = new THREE.Group();
  private earthMesh!: THREE.Mesh;
  private earthMaterial!: THREE.MeshStandardMaterial;
  private cloudMesh!: THREE.Mesh;
  private cloudMaterial!: THREE.MeshStandardMaterial;
  private atmosphereMaterial!: THREE.ShaderMaterial;
  private graticuleGroup = new THREE.Group();
  private stationsGroup = new THREE.Group();
  private arcsGroup = new THREE.Group();
  private satellitesGroup = new THREE.Group();
  private sunLight!: THREE.DirectionalLight;

  // Earth shader uniforms (populated via onBeforeCompile)
  private earthUniforms = {
    uSunDir: { value: new THREE.Vector3(1, 0.2, 0.5).normalize() },
    uNightMap: { value: null as THREE.Texture | null },
    uOverlayMap: { value: null as THREE.Texture | null },
    uOverlayMix: { value: 0.0 },
    uCityLightsIntensity: { value: 1.0 },
  };
  private targetOverlayMix = 0.0;

  // Interactive station markers
  private stationNodes = new Map<
    string,
    { group: THREE.Group; ring: THREE.Mesh; tip: THREE.Mesh; hitProxy: THREE.Mesh }
  >();
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
    this.settings = { ...initialSettings };
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
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x060911, 1);

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
    this.scene.background = new THREE.Color(0x060911);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.05, 120);
    const initialPreset = CAMERA_PRESETS[0];
    latLonToVector3(
      initialPreset.lat,
      initialPreset.lon,
      initialPreset.distance,
      this.camera.position,
    );

    // Studio PMREM Environment for crisp metallic satellite reflections (all devices)
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.45;
    pmremGenerator.dispose();

    // OrbitControls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.065;
    this.controls.rotateSpeed = 0.58;
    this.controls.zoomSpeed = 0.85;
    this.controls.minDistance = 1.48;
    this.controls.maxDistance = 5.4;
    this.controls.addEventListener('start', this.handleUserOrbitStart);

    // Lighting Rig (warm solar key, cool space hemisphere fill, subtle rim)
    this.sunLight = new THREE.DirectionalLight(0xfff5e4, 2.75);
    this.sunLight.position.set(10, 3, 6);
    this.scene.add(this.sunLight);

    const hemiLight = new THREE.HemisphereLight(0x7dd3fc, 0x0b1224, 0.24);
    this.scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.35);
    rimLight.position.set(-8, -2, -6);
    this.scene.add(rimLight);

    // Procedural Textures & Geometry
    this.textures = createEarthTextures(this.renderer.capabilities.getMaxAnisotropy());
    this.earthUniforms.uNightMap.value = this.textures.nightMap;
    this.earthUniforms.uOverlayMap.value = this.textures.thermalMap;

    this.buildStarfield();
    this.buildEarthAndAtmosphere();
    this.buildGraticule();
    this.buildStations();
    this.buildGreatCircleArcs();
    this.buildSatellites();

    this.scene.add(this.earthGroup);

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

  private buildStarfield() {
    const count = 2400;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    // Spectral star palette: cool blue-white, pure white, warm gold-orange
    const palette = [
      new THREE.Color(0xcbd5e1),
      new THREE.Color(0xe0f2fe),
      new THREE.Color(0x93c5fd),
      new THREE.Color(0xfef3c7),
      new THREE.Color(0xfde68a),
    ];

    let seed = 918273;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < count; i++) {
      // 35% concentrated subtly along an inclined galactic band
      let theta: number;
      let phi: number;
      if (i < count * 0.35) {
        phi = rand() * Math.PI * 2;
        const bandLat = (rand() - 0.5) * 0.42 + (rand() - 0.5) * 0.25;
        theta = Math.PI / 2 - bandLat;
      } else {
        phi = rand() * Math.PI * 2;
        theta = Math.acos(2 * rand() - 1);
      }

      const r = 34 + rand() * 38;
      let x = r * Math.sin(theta) * Math.cos(phi);
      let y = r * Math.cos(theta);
      let z = r * Math.sin(theta) * Math.sin(phi);

      // Tilt galactic plane by 48°
      if (i < count * 0.35) {
        const tilt = 0.84;
        const ny = y * Math.cos(tilt) - z * Math.sin(tilt);
        const nz = y * Math.sin(tilt) + z * Math.cos(tilt);
        y = ny;
        z = nz;
      }

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const c = palette[Math.floor(rand() * palette.length)];
      const brightness = 0.45 + Math.pow(rand(), 2) * 0.55;
      colors[i * 3] = c.r * brightness;
      colors[i * 3 + 1] = c.g * brightness;
      colors[i * 3 + 2] = c.b * brightness;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      depthWrite: false,
    });

    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    this.scene.add(stars);
  }

  private buildEarthAndAtmosphere() {
    // 1. Primary Earth Sphere with PBR + Custom Day/Night City Lights & Scientific Overlay Shader Extension
    const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, 72, 48);

    this.earthMaterial = new THREE.MeshStandardMaterial({
      map: this.textures.dayMap,
      roughnessMap: this.textures.roughnessMap,
      roughness: 0.96,
      metalness: 0.08,
      bumpMap: this.textures.bumpMap,
      bumpScale: 0.018,
    });

    const uniformsRef = this.earthUniforms;
    this.earthMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir = uniformsRef.uSunDir;
      shader.uniforms.uNightMap = uniformsRef.uNightMap;
      shader.uniforms.uOverlayMap = uniformsRef.uOverlayMap;
      shader.uniforms.uOverlayMix = uniformsRef.uOverlayMix;
      shader.uniforms.uCityLightsIntensity = uniformsRef.uCityLightsIntensity;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `
          #include <common>
          varying vec3 vEarthWorldNormal;
          varying vec3 vEarthWorldPos;
          `,
        )
        .replace(
          '#include <worldpos_vertex>',
          `
          #include <worldpos_vertex>
          vEarthWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
          vEarthWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          `,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `
          #include <common>
          uniform vec3 uSunDir;
          uniform sampler2D uNightMap;
          uniform sampler2D uOverlayMap;
          uniform float uOverlayMix;
          uniform float uCityLightsIntensity;
          varying vec3 vEarthWorldNormal;
          varying vec3 vEarthWorldPos;
          `,
        )
        .replace(
          '#include <map_fragment>',
          `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D( map, vMapUv );
            vec4 overlaySample = texture2D( uOverlayMap, vMapUv );
            sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, overlaySample.rgb, uOverlayMix);
            diffuseColor *= sampledDiffuseColor;
          #endif
          `,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `
          #include <emissivemap_fragment>
          vec3 wn = normalize(vEarthWorldNormal);
          vec3 sDir = normalize(uSunDir);
          float ndl = dot(wn, sDir);

          // Night-side city lights smoothly emerging across the solar terminator
          float nightFactor = smoothstep(0.16, -0.22, ndl);
          vec3 cityTex = texture2D(uNightMap, vMapUv).rgb;
          totalEmissiveRadiance += cityTex * nightFactor * uCityLightsIntensity * (1.0 - uOverlayMix * 0.78) * 1.38;

          // Subtle self-illumination for scientific overlay legibility on the night hemisphere
          if (uOverlayMix > 0.01) {
            vec3 overlaySelf = texture2D(uOverlayMap, vMapUv).rgb;
            totalEmissiveRadiance += overlaySelf * uOverlayMix * (0.28 + 0.24 * nightFactor);
          }

          // Warm amber-rose Rayleigh scattering right along the twilight terminator
          float twilight = exp(-pow((ndl + 0.02) / 0.13, 2.0));
          totalEmissiveRadiance += vec3(0.24, 0.09, 0.04) * twilight * (1.0 - uOverlayMix * 0.7);

          // Subtle inner blue atmospheric Fresnel limb glow on the sunlit side
          vec3 viewDirW = normalize(cameraPosition - vEarthWorldPos);
          float fresnel = pow(1.0 - max(dot(viewDirW, wn), 0.0), 3.4);
          float sunSide = smoothstep(-0.25, 0.55, ndl);
          totalEmissiveRadiance += vec3(0.14, 0.48, 0.92) * fresnel * sunSide * 0.42;
          `,
        );
    };

    this.earthMesh = new THREE.Mesh(earthGeo, this.earthMaterial);
    this.earthMesh.name = 'earth-surface';
    this.earthGroup.add(this.earthMesh);

    // 2. Drifting Dynamic Cloud Sphere
    const cloudGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.014, 60, 40);
    this.cloudMaterial = new THREE.MeshStandardMaterial({
      map: this.textures.cloudMap,
      transparent: true,
      opacity: 0.74,
      depthWrite: false,
      roughness: 0.94,
      metalness: 0.0,
    });
    this.cloudMesh = new THREE.Mesh(cloudGeo, this.cloudMaterial);
    this.cloudMesh.renderOrder = 2;
    this.earthGroup.add(this.cloudMesh);

    // 3. Outer Atmospheric Rayleigh Scattering Halo
    const atmoGeo = new THREE.SphereGeometry(EARTH_RADIUS * 1.088, 64, 42);
    this.atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: this.earthUniforms.uSunDir,
      },
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        void main() {
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPosition = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        void main() {
          vec3 n = normalize(vWorldNormal);
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          // BackSide sphere: dot(viewDir, -n) is near 0 at outer rim, larger inward
          float rim = clamp(1.0 - max(dot(viewDir, -n), 0.0), 0.0, 1.0);
          float glow = pow(rim, 3.2);

          float sunDot = dot(n, normalize(uSunDir));
          float daySide = smoothstep(-0.35, 0.55, sunDot);
          float twilight = exp(-pow((sunDot + 0.05) / 0.22, 2.0));

          vec3 dayColor = vec3(0.24, 0.64, 1.0);
          vec3 twilightColor = vec3(0.95, 0.45, 0.18);
          vec3 nightColor = vec3(0.05, 0.14, 0.30);

          vec3 finalColor = mix(nightColor, dayColor, daySide);
          finalColor = mix(finalColor, twilightColor, twilight * 0.45);

          float alpha = glow * (0.14 + 0.68 * daySide);
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });

    const atmoMesh = new THREE.Mesh(atmoGeo, this.atmosphereMaterial);
    atmoMesh.renderOrder = 3;
    this.scene.add(atmoMesh);
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

    // Parallels every 15° (-75° to +75°)
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

    // Meridians every 15° (-180° to +165°)
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

      // Align local +Y along outward surface normal
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

    // Instanced animated signal packets gliding along the great-circle curves (2 per arc)
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
      this.packetPhases.push((i % 2) * 0.5 + (i * 0.13) % 1);
      this.packetSpeeds.push(0.16 + ((i * 37) % 10) * 0.011);
    }
    this.arcsGroup.add(this.packetMesh);
    this.earthGroup.add(this.arcsGroup);
  }

  private buildSatellites() {
    for (const sat of SATELLITES) {
      // Orbital plane orientation: rotate around Y by RAAN, then tilt around X by inclination
      const raanRad = THREE.MathUtils.degToRad(sat.raanDeg);
      const incRad = THREE.MathUtils.degToRad(sat.inclinationDeg);
      const qRaan = new THREE.Quaternion().setFromAxisAngle(_up, raanRad);
      const qInc = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        incRad,
      );
      const orbitPlaneQuat = qRaan.multiply(qInc);

      // Orbital path ring
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

      // Composite 3D spacecraft model
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

  private updateSunDirection(hourUtc: number) {
    // At 12:00 UTC the subsolar longitude is 0° (Prime Meridian).
    // Earth rotates 15°/hr eastward -> subsolar lon = (12 - hourUtc) * 15°.
    // Solar declination ~ -19.8° for late November.
    const subSolarLon = (12 - hourUtc) * 15;
    const declinationDeg = -19.8;
    latLonToVector3(declinationDeg, subSolarLon, 1.0, _vecA);

    // Account for Earth's current Y rotation so solar UTC stays aligned to real geography
    _vecA.applyAxisAngle(_up, this.earthGroup.rotation.y).normalize();

    this.earthUniforms.uSunDir.value.copy(_vecA);
    this.sunLight.position.copy(_vecA).multiplyScalar(12);
  }

  public applySettings(next: SceneSettings) {
    const prevMode = this.settings.dataMode;
    this.settings = { ...next };

    this.cloudMesh.visible = next.showClouds;
    this.graticuleGroup.visible = next.showGraticule;
    this.stationsGroup.visible = next.showStations;
    this.arcsGroup.visible = next.showArcs;
    this.satellitesGroup.visible = next.showSatellites;

    this.earthUniforms.uCityLightsIntensity.value = next.showCityLights ? 1.0 : 0.0;

    if (next.dataMode === 'natural') {
      this.targetOverlayMix = 0.0;
    } else {
      this.targetOverlayMix = 0.88;
      if (next.dataMode !== prevMode || this.earthUniforms.uOverlayMap.value === null) {
        if (next.dataMode === 'thermal') {
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

    this.updateSunDirection(next.solarHourUtc);
  }

  public flyToPreset(presetId: CameraPresetId) {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.trackingSatelliteId = null;
    const targetPos = latLonToVector3(preset.lat, preset.lon, preset.distance);
    targetPos.applyAxisAngle(_up, this.earthGroup.rotation.y);
    this.cameraFlyTarget = targetPos;
  }

  public flyToStation(stationId: string) {
    const station = STATIONS.find((s) => s.id === stationId);
    if (!station) return;
    this.trackingSatelliteId = null;
    const targetPos = latLonToVector3(station.lat, station.lon, 2.22);
    targetPos.applyAxisAngle(_up, this.earthGroup.rotation.y);
    this.cameraFlyTarget = targetPos;
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

  private handlePointerUp = (event: PointerEvent) => {
    const dx = event.clientX - this.pointerDownPos.x;
    const dy = event.clientY - this.pointerDownPos.y;
    if (dx * dx + dy * dy > 36) return; // Dragged to orbit, not a click

    this.updatePointerNdc(event);
    this.raycaster.layers.set(1);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const activeProxies = this.interactiveProxies.filter((obj) => {
      if (obj.userData.kind === 'station' && !this.settings.showStations) return false;
      if (obj.userData.kind === 'satellite' && !this.settings.showSatellites) return false;
      return true;
    });

    const hits = this.raycaster.intersectObjects(activeProxies, false);
    if (hits.length > 0) {
      const hitData = hits[0].object.userData as { kind: 'station' | 'satellite'; id: string };
      this.callbacks.onSelectTarget(hitData);
      if (hitData.kind === 'station') {
        this.flyToStation(hitData.id);
      } else {
        this.flyToSatellite(hitData.id);
      }
      return;
    }

    // Clicked empty space or Earth surface away from markers: keep current view
  };

  private handlePointerMove = (event: PointerEvent) => {
    const now = performance.now();
    if (now - this.lastPointerMoveMs < 45) return;
    this.lastPointerMoveMs = now;

    this.updatePointerNdc(event);

    // 1. Check interactive stations & satellites on layer 1
    this.raycaster.layers.set(1);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const activeProxies = this.interactiveProxies.filter((obj) => {
      if (obj.userData.kind === 'station' && !this.settings.showStations) return false;
      if (obj.userData.kind === 'satellite' && !this.settings.showSatellites) return false;
      return true;
    });

    const proxyHits = this.raycaster.intersectObjects(activeProxies, false);
    if (proxyHits.length > 0) {
      const hitObj = proxyHits[0].object;
      const { kind, id } = hitObj.userData as { kind: 'station' | 'satellite'; id: string };
      this.renderer.domElement.style.cursor = 'pointer';

      hitObj.getWorldPosition(_vecB);
      _vecB.project(this.camera);
      const rect = this.renderer.domElement.getBoundingClientRect();
      const sx = ((_vecB.x + 1) / 2) * rect.width;
      const sy = ((-_vecB.y + 1) / 2) * rect.height;

      if (kind === 'station') {
        const st = STATIONS.find((s) => s.id === id);
        if (st) {
          this.callbacks.onHoverTarget({
            kind,
            id,
            label: st.name,
            sublabel: `${st.primaryMetricLabel}: ${st.primaryMetricValue} ${st.primaryMetricUnit}`,
            x: sx,
            y: sy,
          });
        }
      } else {
        const sat = SATELLITES.find((s) => s.id === id);
        if (sat) {
          this.callbacks.onHoverTarget({
            kind,
            id,
            label: sat.name,
            sublabel: `${sat.orbitType} · ${sat.altitudeKm.toLocaleString()} km`,
            x: sx,
            y: sy,
          });
        }
      }
    } else {
      this.renderer.domElement.style.cursor = 'grab';
      this.callbacks.onHoverTarget(null);
    }

    // 2. Raycast Earth sphere on layer 0 for live surface latitude/longitude cursor readout
    this.raycaster.layers.set(0);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const earthHits = this.raycaster.intersectObject(this.earthMesh, false);
    if (earthHits.length > 0) {
      _vecC.copy(earthHits[0].point);
      this.earthGroup.worldToLocal(_vecC);
      const coords = vector3ToLatLon(_vecC);
      this.callbacks.onCursorCoords(coords);
    } else {
      this.callbacks.onCursorCoords(null);
    }
  };

  private handlePointerLeave = () => {
    this.callbacks.onHoverTarget(null);
    this.callbacks.onCursorCoords(null);
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

    // 1. Gentle globe auto-rotation & independent atmospheric cloud drift
    if (this.settings.autoRotate && !this.cameraFlyTarget && !this.trackingSatelliteId) {
      this.earthGroup.rotation.y += dt * 0.042;
      this.updateSunDirection(this.settings.solarHourUtc);
    }
    if (this.settings.showClouds) {
      this.cloudMesh.rotation.y += dt * 0.011;
    }

    // Smoothly adjust cloud opacity when viewing data overlays so heatmaps stay vivid
    const desiredCloudOpacity = this.settings.dataMode === 'natural' ? 0.74 : 0.16;
    this.cloudMaterial.opacity = THREE.MathUtils.damp(
      this.cloudMaterial.opacity,
      desiredCloudOpacity,
      5.0,
      dt,
    );

    // 2. Smoothly crossfade data overlay mix in the Earth shader
    this.earthUniforms.uOverlayMix.value = THREE.MathUtils.damp(
      this.earthUniforms.uOverlayMix.value,
      this.targetOverlayMix,
      5.5,
      dt,
    );

    // 3. Optional continuous solar time advancement
    if (this.settings.solarAutoAdvance) {
      this.settings.solarHourUtc = (this.settings.solarHourUtc + dt * 0.85) % 24;
      this.updateSunDirection(this.settings.solarHourUtc);
      if (now - this.lastSolarEmitMs > 140) {
        this.lastSolarEmitMs = now;
        this.callbacks.onSolarHourTick(this.settings.solarHourUtc);
      }
    }

    // 4. Animate instanced signal packets along great-circle arcs (zero GC)
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

    // 5. Advance orbital satellites along their inclined orbital planes
    const shouldEmitSatPos = now - this.lastSatPosEmitMs > 280;
    const livePositions: SatelliteLivePos[] = [];
    for (const sat of this.satEntries) {
      sat.angle = (sat.angle + dt * sat.config.angularSpeedRad) % (Math.PI * 2);
      const r = sat.config.visualRadius;
      _vecA.set(Math.cos(sat.angle) * r, 0, Math.sin(sat.angle) * r);
      _vecA.applyQuaternion(sat.orbitPlaneQuat);
      sat.group.position.copy(_vecA);
      // Orient spacecraft nadir toward Earth's center
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

    // 6. Smooth damped spherical camera fly-to
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
    this.renderer.render(this.scene, this.camera);

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

    if (this.textures) {
      this.textures.dispose();
    }
    disposeSharedSatelliteAssets();

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
