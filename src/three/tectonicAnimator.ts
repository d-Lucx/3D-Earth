import * as THREE from 'three';
import {
  DEEP_TIME_CHAPTERS,
  type DeepTimeEraId,
  type StoryBeacon,
  type StoryBeaconAction,
} from '../data/deepTimeData';
import { latLonToVector3 } from '../data/earthData';

export interface DeepTimeRigUpdateContext {
  dt: number;
  elapsedSec: number;
  active: boolean;
  eraId: DeepTimeEraId;
  driftProgress: number;
  lunarDistanceRe: number;
  riftMeltProgress: number;
}

export interface DeepTimeRig {
  /** Attached to earthGroup so surface beacons, plates & impacts rotate with the planet */
  surfaceGroup: THREE.Group;
  /** Attached to axialTiltGroup / scene so orbital Theia, debris ring & Moon orbit Earth */
  orbitalGroup: THREE.Group;
  /** Layer-1 raycast hit proxies for interactive Story Beacons */
  beaconHitProxies: THREE.Object3D[];
  beaconMap: Map<string, StoryBeacon>;
  setActiveEra: (active: boolean, eraId: DeepTimeEraId) => void;
  triggerAction: (action: StoryBeaconAction) => void;
  /** Returns dynamic transient ash pulse (0..1) from Chicxulub impact for Earth shader */
  update: (ctx: DeepTimeRigUpdateContext) => { chicxulubAshPulse: number };
  dispose: () => void;
}

// Reusable scratch math helpers (zero allocations inside tick)
const _up = new THREE.Vector3(0, 1, 0);
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qCur = new THREE.Quaternion();

interface PlateSpec {
  id: string;
  label: string;
  color: string;
  polygon: [number, number][]; // [lon, lat] in modern coordinates
  /** Quaternion rotating modern plate back to its ~250 Ma Pangaea position */
  pangaeaEulerDeg: [number, number, number];
}

// 7 simplified continental tectonic plates for Chapter 5 (Pangaea -> Modern Drift)
const TECTONIC_PLATES: PlateSpec[] = [
  {
    id: 'laurentia',
    label: 'Laurentia (N. America)',
    color: '#34d399',
    polygon: [
      [-130, 56], [-115, 65], [-85, 64], [-62, 52], [-72, 38], [-82, 24],
      [-98, 20], [-108, 28], [-122, 38], [-128, 48],
    ],
    pangaeaEulerDeg: [-14, 38, 12],
  },
  {
    id: 'south-america',
    label: 'South America',
    color: '#2dd4bf',
    polygon: [
      [-76, 8], [-58, 6], [-36, -6], [-42, -22], [-56, -38], [-68, -52],
      [-74, -40], [-78, -14],
    ],
    pangaeaEulerDeg: [8, 36, -24],
  },
  {
    id: 'africa',
    label: 'Africa',
    color: '#10b981',
    polygon: [
      [-16, 16], [-6, 35], [12, 36], [32, 31], [42, 12], [50, 8],
      [40, -14], [30, -32], [18, -34], [12, -14], [8, 4], [-8, 5],
    ],
    pangaeaEulerDeg: [4, -4, 2],
  },
  {
    id: 'eurasia',
    label: 'Eurasia',
    color: '#4ade80',
    polygon: [
      [-8, 38], [6, 54], [28, 66], [68, 68], [116, 66], [140, 54],
      [122, 34], [104, 20], [82, 28], [56, 26], [36, 36], [12, 44],
    ],
    pangaeaEulerDeg: [-10, -18, -10],
  },
  {
    id: 'india',
    label: 'Indian Plate',
    color: '#fbbf24',
    polygon: [
      [68, 24], [78, 30], [88, 25], [84, 14], [77, 8], [72, 16],
    ],
    pangaeaEulerDeg: [-32, -28, 44],
  },
  {
    id: 'australia',
    label: 'Australia',
    color: '#38bdf8',
    polygon: [
      [114, -22], [130, -12], [146, -16], [153, -28], [146, -38], [130, -34], [115, -34],
    ],
    pangaeaEulerDeg: [-24, -48, -32],
  },
  {
    id: 'antarctica',
    label: 'Antarctica',
    color: '#93c5fd',
    polygon: [
      [-60, -68], [-20, -72], [25, -70], [75, -70], [130, -68], [170, -74], [-130, -76], [-85, -73],
    ],
    pangaeaEulerDeg: [6, -12, 8],
  },
];

/**
 * Builds a slightly elevated spherical cap mesh from a [lon, lat] polygon
 * so each tectonic plate hugs the curved Earth sphere smoothly as it drifts.
 */
function createSphericalPlateGeometry(
  polygon: [number, number][],
  radius: number,
): THREE.BufferGeometry {
  // Compute spherical centroid
  const center = new THREE.Vector3();
  const boundaryPts = polygon.map(([lon, lat]) => latLonToVector3(lat, lon, radius));
  for (const p of boundaryPts) center.add(p);
  center.normalize().multiplyScalar(radius);

  // Subdivide perimeter edges & create radial rings toward centroid for smooth spherical curvature
  const ringPts: THREE.Vector3[] = [];
  for (let i = 0; i < boundaryPts.length; i++) {
    const a = boundaryPts[i];
    const b = boundaryPts[(i + 1) % boundaryPts.length];
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const pt = new THREE.Vector3().lerpVectors(a, b, t).normalize().multiplyScalar(radius);
      ringPts.push(pt);
    }
  }

  const N = ringPts.length;
  const positions: number[] = [];
  const indices: number[] = [];

  // Index 0 = center
  positions.push(center.x, center.y, center.z);
  // Ring 1 = halfway from center to perimeter (indices 1..N)
  for (let i = 0; i < N; i++) {
    const mid = new THREE.Vector3()
      .lerpVectors(center, ringPts[i], 0.52)
      .normalize()
      .multiplyScalar(radius);
    positions.push(mid.x, mid.y, mid.z);
  }
  // Ring 2 = outer perimeter (indices N+1..2N)
  for (let i = 0; i < N; i++) {
    positions.push(ringPts[i].x, ringPts[i].y, ringPts[i].z);
  }

  for (let i = 0; i < N; i++) {
    const next = (i + 1) % N;
    const m0 = 1 + i;
    const m1 = 1 + next;
    const o0 = 1 + N + i;
    const o1 = 1 + N + next;

    // Inner fan triangle
    indices.push(0, m0, m1);
    // Outer quad (2 triangles)
    indices.push(m0, o0, o1);
    indices.push(m0, o1, m1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildDeepTimeRig(earthRadius: number): DeepTimeRig {
  const surfaceGroup = new THREE.Group();
  surfaceGroup.name = 'deep-time-surface';
  surfaceGroup.visible = false;

  const orbitalGroup = new THREE.Group();
  orbitalGroup.name = 'deep-time-orbital';
  orbitalGroup.visible = false;

  const disposables: { dispose: () => void }[] = [];
  const beaconHitProxies: THREE.Object3D[] = [];
  const beaconMap = new Map<string, StoryBeacon>();

  // ---------------------------------------------------------------------------
  // 1. Story Beacons (grouped per era so only active chapter beacons show)
  // ---------------------------------------------------------------------------
  const eraBeaconGroups = new Map<DeepTimeEraId, THREE.Group>();
  const beaconRings: { mesh: THREE.Mesh; phase: number }[] = [];

  const beaconStemGeo = new THREE.CylinderGeometry(0.0024, 0.0042, 0.068, 8);
  beaconStemGeo.translate(0, 0.034, 0);
  const beaconOrbGeo = new THREE.OctahedronGeometry(0.015, 1);
  const beaconRingGeo = new THREE.RingGeometry(0.02, 0.027, 28);
  beaconRingGeo.rotateX(-Math.PI / 2);
  const beaconProxyGeo = new THREE.SphereGeometry(0.06, 10, 10);
  const beaconProxyMat = new THREE.MeshBasicMaterial({ visible: false });
  disposables.push(beaconStemGeo, beaconOrbGeo, beaconRingGeo, beaconProxyGeo, beaconProxyMat);

  for (const chapter of DEEP_TIME_CHAPTERS) {
    const grp = new THREE.Group();
    grp.visible = false;
    chapter.beacons.forEach((beacon, idx) => {
      beaconMap.set(beacon.id, beacon);
      const col = new THREE.Color(beacon.accentColor);

      const node = new THREE.Group();
      const pos = latLonToVector3(beacon.lat, beacon.lon, earthRadius * 1.006);
      node.position.copy(pos);
      node.quaternion.setFromUnitVectors(_up, pos.clone().normalize());

      const stemMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.85,
      });
      const stem = new THREE.Mesh(beaconStemGeo, stemMat);
      node.add(stem);

      const orbMat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 1.9,
        roughness: 0.2,
        metalness: 0.15,
      });
      const orb = new THREE.Mesh(beaconOrbGeo, orbMat);
      orb.position.y = 0.072;
      node.add(orb);

      const ringMat = new THREE.MeshBasicMaterial({
        color: col,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(beaconRingGeo, ringMat);
      ring.position.y = 0.005;
      node.add(ring);
      beaconRings.push({ mesh: ring, phase: idx * 0.45 });

      const proxy = new THREE.Mesh(beaconProxyGeo, beaconProxyMat);
      proxy.position.y = 0.045;
      proxy.layers.set(1);
      proxy.userData = { kind: 'beacon', id: beacon.id, eraId: chapter.id };
      node.add(proxy);

      beaconHitProxies.push(proxy);
      disposables.push(stemMat, orbMat, ringMat);
      grp.add(node);
    });
    eraBeaconGroups.set(chapter.id, grp);
    surfaceGroup.add(grp);
  }

  // ---------------------------------------------------------------------------
  // 2. Chapter 1: Theia Oblique Collision, Glowing Debris Ring & Dynamic Moon + Tidal Bulge
  // ---------------------------------------------------------------------------
  const theiaGroup = new THREE.Group();
  const theiaGeo = new THREE.SphereGeometry(earthRadius * 0.44, 32, 24);
  const theiaMat = new THREE.MeshStandardMaterial({
    color: 0x9a3412,
    emissive: 0xea580c,
    emissiveIntensity: 0.9,
    roughness: 0.82,
  });
  const theiaMesh = new THREE.Mesh(theiaGeo, theiaMat);
  theiaGroup.add(theiaMesh);

  // Impact flash glow sphere at equatorial strike zone
  const flashGeo = new THREE.SphereGeometry(earthRadius * 0.24, 24, 18);
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffedd5,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const theiaFlash = new THREE.Mesh(flashGeo, flashMat);
  theiaGroup.add(theiaFlash);

  // Glowing silicate ejecta debris ring coalescing around Earth
  const debrisCount = 1100;
  const debrisPos = new Float32Array(debrisCount * 3);
  const debrisCol = new Float32Array(debrisCount * 3);
  const cHot = new THREE.Color('#fde68a');
  const cWarm = new THREE.Color('#f97316');
  const cCool = new THREE.Color('#9a3412');

  let dSeed = 7731;
  const dRand = () => {
    dSeed = (Math.imul(dSeed, 1664525) + 1013904223) >>> 0;
    return dSeed / 4294967296;
  };
  for (let i = 0; i < debrisCount; i++) {
    const ang = dRand() * Math.PI * 2;
    const rad = earthRadius * (1.38 + Math.pow(dRand(), 0.72) * 1.42);
    const ySpread = (dRand() - 0.5) * 0.14 * (rad / 1.8);
    debrisPos[i * 3] = Math.cos(ang) * rad;
    debrisPos[i * 3 + 1] = ySpread;
    debrisPos[i * 3 + 2] = Math.sin(ang) * rad;

    const heat = dRand();
    const c = heat > 0.65 ? cHot : heat > 0.25 ? cWarm : cCool;
    debrisCol[i * 3] = c.r;
    debrisCol[i * 3 + 1] = c.g;
    debrisCol[i * 3 + 2] = c.b;
  }
  const debrisGeo = new THREE.BufferGeometry();
  debrisGeo.setAttribute('position', new THREE.BufferAttribute(debrisPos, 3));
  debrisGeo.setAttribute('color', new THREE.BufferAttribute(debrisCol, 3));
  const debrisMat = new THREE.PointsMaterial({
    size: 0.036,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const debrisRing = new THREE.Points(debrisGeo, debrisMat);
  debrisRing.rotation.z = 0.26;
  theiaGroup.add(debrisRing);
  orbitalGroup.add(theiaGroup);
  disposables.push(theiaGeo, theiaMat, flashGeo, flashMat, debrisGeo, debrisMat);

  // Orbiting Moon + Subtle Tidal Bulge (visible across Deep Time, scales with Lunar Distance slider)
  const moonGeo = new THREE.SphereGeometry(earthRadius * 0.21, 28, 22);
  const moonMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.92,
    metalness: 0.04,
  });
  const moonMesh = new THREE.Mesh(moonGeo, moonMat);
  orbitalGroup.add(moonMesh);

  const tidalGeo = new THREE.SphereGeometry(earthRadius * 1.028, 40, 28);
  const tidalMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.0,
    wireframe: true,
    depthWrite: false,
  });
  const tidalBulgeMesh = new THREE.Mesh(tidalGeo, tidalMat);
  orbitalGroup.add(tidalBulgeMesh);
  disposables.push(moonGeo, moonMat, tidalGeo, tidalMat);

  // ---------------------------------------------------------------------------
  // 3. Chapter 2: Hadean Late Heavy Bombardment Asteroids & Shockwaves
  // ---------------------------------------------------------------------------
  const hadeanGroup = new THREE.Group();
  const asteroidGeo = new THREE.DodecahedronGeometry(0.022, 0);
  const asteroidMat = new THREE.MeshStandardMaterial({
    color: 0x78350f,
    emissive: 0xf97316,
    emissiveIntensity: 1.6,
    roughness: 0.8,
  });
  const trailGeo = new THREE.ConeGeometry(0.018, 0.24, 8, 1, true);
  trailGeo.translate(0, 0.12, 0);
  const trailMat = new THREE.MeshBasicMaterial({
    color: 0xfdba74,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const shockGeo = new THREE.RingGeometry(0.018, 0.028, 28);
  shockGeo.rotateX(-Math.PI / 2);
  disposables.push(asteroidGeo, asteroidMat, trailGeo, trailMat, shockGeo);

  const meteorSlots: {
    group: THREE.Group;
    shockMesh: THREE.Mesh;
    shockMat: THREE.MeshBasicMaterial;
    targetDir: THREE.Vector3;
    entryDir: THREE.Vector3;
    phase: number;
    speed: number;
  }[] = [];

  for (let i = 0; i < 8; i++) {
    const lat = ((i * 37) % 120) - 60;
    const lon = ((i * 79) % 340) - 170;
    const targetDir = latLonToVector3(lat, lon, 1.0).normalize();
    const entryDir = targetDir
      .clone()
      .add(new THREE.Vector3(0.45 * ((i % 2) * 2 - 1), 0.3, -0.35))
      .normalize();

    const mGrp = new THREE.Group();
    const rock = new THREE.Mesh(asteroidGeo, asteroidMat);
    const trail = new THREE.Mesh(trailGeo, trailMat);
    mGrp.add(rock, trail);
    hadeanGroup.add(mGrp);

    const shockMat = new THREE.MeshBasicMaterial({
      color: 0xfb923c,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shockMesh = new THREE.Mesh(shockGeo, shockMat);
    shockMesh.position.copy(targetDir).multiplyScalar(earthRadius * 1.009);
    shockMesh.quaternion.setFromUnitVectors(_up, targetDir);
    hadeanGroup.add(shockMesh);
    disposables.push(shockMat);

    meteorSlots.push({
      group: mGrp,
      shockMesh,
      shockMat,
      targetDir,
      entryDir,
      phase: i / 8,
      speed: 0.34 + (i % 3) * 0.08,
    });
  }
  surfaceGroup.add(hadeanGroup);

  // ---------------------------------------------------------------------------
  // 4. Chapter 3: Archean Stromatolite Coastal Cyan O2 Plumes
  // ---------------------------------------------------------------------------
  const archeanGroup = new THREE.Group();
  const stromSites: [number, number][] = [
    [-21.2, 119.5], // Pilbara
    [-25.8, 31.1],  // Barberton
    [65.1, -115.5], // Slave Craton
    [-16.0, 124.0], // Kimberley
    [-28.5, 24.5],  // Kaapvaal
  ];
  const plumeCount = stromSites.length * 36;
  const plumePos = new Float32Array(plumeCount * 3);
  const plumeSeeds = new Float32Array(plumeCount);
  const plumeNormals: THREE.Vector3[] = [];
  const plumeBases: THREE.Vector3[] = [];

  for (let i = 0; i < plumeCount; i++) {
    const site = stromSites[Math.floor(i / 36)];
    const jitterLat = site[0] + (dRand() - 0.5) * 14;
    const jitterLon = site[1] + (dRand() - 0.5) * 18;
    const base = latLonToVector3(jitterLat, jitterLon, earthRadius * 1.008);
    plumeBases.push(base);
    plumeNormals.push(base.clone().normalize());
    plumeSeeds[i] = dRand();
    plumePos[i * 3] = base.x;
    plumePos[i * 3 + 1] = base.y;
    plumePos[i * 3 + 2] = base.z;
  }
  const plumeGeo = new THREE.BufferGeometry();
  plumeGeo.setAttribute('position', new THREE.BufferAttribute(plumePos, 3));
  const plumeMat = new THREE.PointsMaterial({
    color: 0x2dd4bf,
    size: 0.028,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const plumePoints = new THREE.Points(plumeGeo, plumeMat);
  archeanGroup.add(plumePoints);
  surfaceGroup.add(archeanGroup);
  disposables.push(plumeGeo, plumeMat);

  // ---------------------------------------------------------------------------
  // 5. Chapter 4: Snowball Earth Equatorial Volcanic Rift Beacons & Plumes
  // ---------------------------------------------------------------------------
  const snowballGroup = new THREE.Group();
  const riftCoords: [number, number][] = [
    [4.5, 36.2],
    [-4.0, 34.5],
    [9.2, 40.4],
    [-12.0, 28.0],
    [-1.5, -78.2],
    [-6.2, 106.8],
  ];
  const riftGlowGeo = new THREE.SphereGeometry(0.028, 12, 12);
  const riftGlowMat = new THREE.MeshBasicMaterial({
    color: 0xfb7185,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const riftNodes: THREE.Mesh[] = [];
  for (const [lat, lon] of riftCoords) {
    const m = new THREE.Mesh(riftGlowGeo, riftGlowMat);
    m.position.copy(latLonToVector3(lat, lon, earthRadius * 1.012));
    snowballGroup.add(m);
    riftNodes.push(m);
  }
  surfaceGroup.add(snowballGroup);
  disposables.push(riftGlowGeo, riftGlowMat);

  // ---------------------------------------------------------------------------
  // 6. Chapter 5: Pangaea -> Modern 3D Tectonic Continental Plate Shells
  // ---------------------------------------------------------------------------
  const pangaeaGroup = new THREE.Group();
  const plateEntries: {
    pivot: THREE.Group;
    pangaeaQuat: THREE.Quaternion;
    modernQuat: THREE.Quaternion;
    material: THREE.MeshStandardMaterial;
  }[] = [];

  for (const spec of TECTONIC_PLATES) {
    const pivot = new THREE.Group();
    const plateGeo = createSphericalPlateGeometry(spec.polygon, earthRadius * 1.011);
    const col = new THREE.Color(spec.color);
    const plateMat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 0.24,
      roughness: 0.72,
      metalness: 0.08,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(plateGeo, plateMat);
    pivot.add(mesh);

    // Bright tectonic plate perimeter wireframe highlight
    const edgePts = spec.polygon.map(([lon, lat]) =>
      latLonToVector3(lat, lon, earthRadius * 1.0135),
    );
    edgePts.push(edgePts[0].clone());
    const edgeGeo = new THREE.BufferGeometry().setFromPoints(edgePts);
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.72,
    });
    const edgeLine = new THREE.Line(edgeGeo, edgeMat);
    pivot.add(edgeLine);

    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(spec.pangaeaEulerDeg[0]),
      THREE.MathUtils.degToRad(spec.pangaeaEulerDeg[1]),
      THREE.MathUtils.degToRad(spec.pangaeaEulerDeg[2]),
      'YXZ',
    );
    const pangaeaQuat = new THREE.Quaternion().setFromEuler(euler);
    const modernQuat = new THREE.Quaternion(); // identity = modern coordinates

    pangaeaGroup.add(pivot);
    plateEntries.push({ pivot, pangaeaQuat, modernQuat, material: plateMat });
    disposables.push(plateGeo, plateMat, edgeGeo, edgeMat);
  }

  // Glowing Himalayan collision arc when India reaches Eurasia (driftProgress > 0.78)
  const himalayaArcPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const lon = 71 + t * 26;
    const lat = 34 - Math.sin(t * Math.PI) * 5.5;
    himalayaArcPts.push(latLonToVector3(lat, lon, earthRadius * 1.017));
  }
  const himalayaGeo = new THREE.BufferGeometry().setFromPoints(himalayaArcPts);
  const himalayaMat = new THREE.LineBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.0,
  });
  const himalayaLine = new THREE.Line(himalayaGeo, himalayaMat);
  pangaeaGroup.add(himalayaLine);
  surfaceGroup.add(pangaeaGroup);
  disposables.push(himalayaGeo, himalayaMat);

  // ---------------------------------------------------------------------------
  // 7. Chapter 6: Cretaceous Chicxulub Asteroid Entry & Ballistic Ejecta Plume
  // ---------------------------------------------------------------------------
  const chicxulubGroup = new THREE.Group();
  const chicPos = latLonToVector3(21.4, -89.5, earthRadius * 1.008);
  const chicNormal = chicPos.clone().normalize();
  const chicEntryStart = chicNormal
    .clone()
    .add(new THREE.Vector3(0.42, 0.34, 0.25))
    .normalize()
    .multiplyScalar(earthRadius * 2.45);

  const bolideGeo = new THREE.DodecahedronGeometry(0.032, 1);
  const bolideMat = new THREE.MeshStandardMaterial({
    color: 0xfff7ed,
    emissive: 0xf43f5e,
    emissiveIntensity: 2.2,
    roughness: 0.4,
  });
  const bolideMesh = new THREE.Mesh(bolideGeo, bolideMat);
  bolideMesh.visible = false;
  chicxulubGroup.add(bolideMesh);

  const chicFlashGeo = new THREE.SphereGeometry(0.11, 20, 16);
  const chicFlashMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const chicFlash = new THREE.Mesh(chicFlashGeo, chicFlashMat);
  chicFlash.position.copy(chicPos);
  chicxulubGroup.add(chicFlash);

  const chicWaveGeo = new THREE.RingGeometry(0.025, 0.048, 48);
  chicWaveGeo.rotateX(-Math.PI / 2);
  const chicWaveMat = new THREE.MeshBasicMaterial({
    color: 0xf43f5e,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const chicWave = new THREE.Mesh(chicWaveGeo, chicWaveMat);
  chicWave.position.copy(chicPos);
  chicWave.quaternion.setFromUnitVectors(_up, chicNormal);
  chicxulubGroup.add(chicWave);

  surfaceGroup.add(chicxulubGroup);
  disposables.push(bolideGeo, bolideMat, chicFlashGeo, chicFlashMat, chicWaveGeo, chicWaveMat);

  // Action timers (0..1 or negative when idle)
  let theiaAnimT = 0.0;
  let chicxulubAnimT = -1.0;
  let plumeBoost = 0.0;
  let bombardmentBoost = 0.0;
  let moonOrbitAngle = 0.65;

  const setActiveEra = (active: boolean, eraId: DeepTimeEraId) => {
    surfaceGroup.visible = active;
    orbitalGroup.visible = active;
    for (const [id, grp] of eraBeaconGroups.entries()) {
      grp.visible = active && id === eraId;
    }
    theiaGroup.visible = active && eraId === 'accretion';
    hadeanGroup.visible = active && eraId === 'hadean';
    archeanGroup.visible = active && eraId === 'archean';
    snowballGroup.visible = active && eraId === 'snowball';
    pangaeaGroup.visible = active && eraId === 'pangaea';
    chicxulubGroup.visible = active && eraId === 'cretaceous';
  };

  const triggerAction = (action: StoryBeaconAction) => {
    if (action === 'theia-impact') {
      theiaAnimT = 0.0;
    } else if (action === 'bombardment-strike') {
      bombardmentBoost = 1.0;
      meteorSlots.forEach((m, i) => {
        m.phase = (i * 0.11) % 0.7;
      });
    } else if (action === 'stromatolite-plume') {
      plumeBoost = 1.0;
    } else if (action === 'chicxulub-impact') {
      chicxulubAnimT = 0.0;
    }
  };

  const update = (ctx: DeepTimeRigUpdateContext): { chicxulubAshPulse: number } => {
    let chicxulubAshPulse = 0;
    if (!ctx.active) return { chicxulubAshPulse: 0 };

    const { dt, elapsedSec, eraId, driftProgress, lunarDistanceRe, riftMeltProgress } = ctx;

    // 1. Gently expand Story Beacon rings
    for (let i = 0; i < beaconRings.length; i++) {
      const b = beaconRings[i];
      b.phase = (b.phase + dt * 0.45) % 1;
      const s = 0.9 + b.phase * 1.4;
      b.mesh.scale.set(s, s, s);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - b.phase) * 0.72;
    }

    // 2. Orbiting Moon & Tidal Bulge (dynamically responds to Lunar Distance What-If slider)
    const moonDist = earthRadius * (1.75 + lunarDistanceRe * 1.45);
    const orbitSpeed = 0.22 / Math.max(0.35, Math.pow(lunarDistanceRe, 1.1));
    moonOrbitAngle = (moonOrbitAngle + dt * orbitSpeed) % (Math.PI * 2);
    moonMesh.position.set(
      Math.cos(moonOrbitAngle) * moonDist,
      Math.sin(moonOrbitAngle * 0.5) * 0.16,
      Math.sin(moonOrbitAngle) * moonDist,
    );
    moonMesh.visible = eraId !== 'accretion' || theiaAnimT > 0.55;

    // Tidal bulge stretches along Earth-Moon line inversely with distance^3
    const tidalStrength = THREE.MathUtils.clamp((1.0 / Math.pow(Math.max(0.4, lunarDistanceRe), 2.2) - 0.75) * 0.14, 0, 0.34);
    if (tidalStrength > 0.015 && eraId !== 'accretion') {
      tidalBulgeMesh.visible = true;
      tidalMat.opacity = Math.min(0.28, tidalStrength * 0.85);
      tidalBulgeMesh.lookAt(moonMesh.position);
      tidalBulgeMesh.scale.set(1.0 - tidalStrength * 0.18, 1.0 - tidalStrength * 0.18, 1.0 + tidalStrength * 0.45);
    } else {
      tidalBulgeMesh.visible = false;
    }

    // 3. Chapter 1: Oblique Theia Collision + Debris Ring
    if (eraId === 'accretion') {
      theiaAnimT = Math.min(1.0, theiaAnimT + dt * 0.14);
      debrisRing.rotation.y += dt * 0.28;

      if (theiaAnimT < 0.36) {
        // Approach arc toward equatorial glancing impact
        const p = theiaAnimT / 0.36;
        const ease = p * p;
        _vA.set(3.4, 0.55, 2.2);
        _vB.set(0.86, 0.18, 0.42);
        theiaMesh.position.lerpVectors(_vA, _vB, ease);
        theiaMesh.visible = true;
        theiaMesh.scale.setScalar(1.0 - ease * 0.2);
        flashMat.opacity = 0;
        debrisMat.opacity = 0.12;
      } else {
        // Post-impact flash & glowing ejecta ring coalescing
        const post = (theiaAnimT - 0.36) / 0.64;
        theiaMesh.visible = post < 0.12;
        theiaMesh.scale.setScalar(Math.max(0.01, 0.8 * (1 - post * 8)));
        theiaFlash.position.set(0.86, 0.18, 0.42);
        const flashCurve = Math.exp(-post * 6.5);
        flashMat.opacity = flashCurve * 0.95;
        theiaFlash.scale.setScalar(1.0 + (1 - flashCurve) * 2.4);
        debrisMat.opacity = Math.min(0.9, 0.25 + post * 0.8);
      }
    }

    // 4. Chapter 2: Hadean Asteroid Bombardment
    if (eraId === 'hadean') {
      bombardmentBoost = Math.max(0, bombardmentBoost - dt * 0.35);
      const speedMult = 1.0 + bombardmentBoost * 1.4;
      for (let i = 0; i < meteorSlots.length; i++) {
        const m = meteorSlots[i];
        m.phase = (m.phase + dt * m.speed * speedMult) % 1.0;

        if (m.phase < 0.52) {
          const p = m.phase / 0.52;
          _vA.copy(m.entryDir).multiplyScalar(earthRadius * 2.35);
          _vB.copy(m.targetDir).multiplyScalar(earthRadius * 1.008);
          m.group.position.lerpVectors(_vA, _vB, p);
          _vC.subVectors(_vA, _vB).normalize();
          m.group.quaternion.setFromUnitVectors(_up, _vC);
          m.group.visible = true;
          m.shockMat.opacity = 0;
        } else {
          m.group.visible = false;
          const sp = (m.phase - 0.52) / 0.48;
          const ringScale = 1.0 + sp * 5.2;
          m.shockMesh.scale.set(ringScale, ringScale, ringScale);
          m.shockMat.opacity = (1 - sp) * 0.85;
        }
      }
    }

    // 5. Chapter 3: Archean Stromatolite Rising Cyan O2 Plumes
    if (eraId === 'archean') {
      plumeBoost = Math.max(0, plumeBoost - dt * 0.32);
      const attr = plumeGeo.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < plumeCount; i++) {
        const t = (elapsedSec * (0.28 + plumeBoost * 0.4) + plumeSeeds[i]) % 1.0;
        const lift = t * (0.14 + plumeBoost * 0.1);
        const base = plumeBases[i];
        const norm = plumeNormals[i];
        arr[i * 3] = base.x + norm.x * lift;
        arr[i * 3 + 1] = base.y + norm.y * lift;
        arr[i * 3 + 2] = base.z + norm.z * lift;
      }
      attr.needsUpdate = true;
      plumeMat.opacity = 0.65 + plumeBoost * 0.35;
    }

    // 6. Chapter 4: Snowball Earth Equatorial Volcanic Rift Glow Nodes
    if (eraId === 'snowball') {
      const pulse = 0.85 + 0.25 * Math.sin(elapsedSec * 3.2);
      const s = (0.75 + riftMeltProgress * 1.45) * pulse;
      for (let i = 0; i < riftNodes.length; i++) {
        riftNodes[i].scale.setScalar(s);
      }
      riftGlowMat.opacity = 0.55 + riftMeltProgress * 0.42;
    }

    // 7. Chapter 5: Pangaea Continental Drift Quaternion Interpolation
    if (eraId === 'pangaea') {
      const smoothDrift = THREE.MathUtils.smoothstep(driftProgress, 0, 1);
      for (let i = 0; i < plateEntries.length; i++) {
        const entry = plateEntries[i];
        _qA.copy(entry.pangaeaQuat);
        _qB.copy(entry.modernQuat);
        _qCur.slerpQuaternions(_qA, _qB, smoothDrift);
        entry.pivot.quaternion.copy(_qCur);
      }
      // Highlight Himalayan collision suture as India impacts Eurasia
      const himalayaGlow = THREE.MathUtils.smoothstep(driftProgress, 0.72, 0.98);
      himalayaMat.opacity = himalayaGlow * 0.92;
    }

    // 8. Chapter 6: Cretaceous Chicxulub Asteroid Entry, Ballistic Shockwave & Ash Surge
    if (eraId === 'cretaceous' && chicxulubAnimT >= 0) {
      chicxulubAnimT += dt * 0.16;
      if (chicxulubAnimT < 0.20) {
        const p = chicxulubAnimT / 0.20;
        bolideMesh.visible = true;
        bolideMesh.position.lerpVectors(chicEntryStart, chicPos, p * p);
        bolideMesh.rotation.x += dt * 6;
        bolideMesh.rotation.y += dt * 4;
        chicFlashMat.opacity = 0;
        chicWaveMat.opacity = 0;
        chicxulubAshPulse = 0;
      } else if (chicxulubAnimT < 1.0) {
        bolideMesh.visible = false;
        const post = (chicxulubAnimT - 0.20) / 0.80;
        const flashEnv = Math.exp(-post * 9.0);
        chicFlashMat.opacity = flashEnv * 0.98;
        chicFlash.scale.setScalar(1.0 + (1 - flashEnv) * 3.0);

        const waveScale = 1.0 + post * 16.0;
        chicWave.scale.set(waveScale, waveScale, waveScale);
        chicWaveMat.opacity = Math.max(0, (1 - post * 1.45) * 0.88);

        // Global impact winter ash rises fast then clears back to modern Earth
        chicxulubAshPulse = Math.sin(post * Math.PI) * 0.92;
      } else {
        chicxulubAnimT = -1.0;
        bolideMesh.visible = false;
        chicFlashMat.opacity = 0;
        chicWaveMat.opacity = 0;
        chicxulubAshPulse = 0;
      }
    }

    return { chicxulubAshPulse };
  };

  return {
    surfaceGroup,
    orbitalGroup,
    beaconHitProxies,
    beaconMap,
    setActiveEra,
    triggerAction,
    update,
    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
}
