import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EARTH_RADIUS, latLonToVector3 } from '../data/earthData';

/**
 * Tilted geomagnetic dipole axis (IGRF-13 reference):
 * Geomagnetic North Pole lies near 80.8° N, 72.8° W (axis pointing toward geographic N,
 * whereas the magnetic dipole moment m points from N pole toward S pole so field lines
 * emerge from the Southern Hemisphere and re-enter near the Northern Magnetic Pole).
 */
export const MAG_NORTH_POLE = { lat: 80.8, lon: -72.8 };
export const MAG_SOUTH_POLE = { lat: -80.8, lon: 107.2 };

export interface MagneticFieldSample {
  /** Total geomagnetic field intensity |B| in microtesla (µT), realistic range ~23–66 µT */
  intensityUt: number;
  /** Magnetic inclination (dip angle) in degrees: +90° straight down (North Pole), -90° straight up (South Pole) */
  inclinationDeg: number;
  /** Magnetic declination (eastward deviation from true geographic north) in degrees */
  declinationDeg: number;
  /** Unit 3D direction vector in Earth's local frame along B */
  directionLocal: THREE.Vector3;
}

// Precomputed dipole basis in Earth's local coordinate frame
const _dipoleAxis = latLonToVector3(MAG_NORTH_POLE.lat, MAG_NORTH_POLE.lon, 1.0).normalize();
const _dipoleMoment = _dipoleAxis.clone().negate(); // B emerges near South, enters near North

// Orthonormal basis perpendicular to dipole axis for L-shell curve generation
const _basisRef = new THREE.Vector3(0, 0, 1);
const _dipoleU = new THREE.Vector3().crossVectors(_dipoleAxis, _basisRef).normalize();
const _dipoleV = new THREE.Vector3().crossVectors(_dipoleAxis, _dipoleU).normalize();

// Module-scoped scratch vectors for zero-GC evaluation
const _posScratch = new THREE.Vector3();
const _rHat = new THREE.Vector3();
const _bVec = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _geoUp = new THREE.Vector3(0, 1, 0);
const _probeQuat = new THREE.Quaternion();
const _probeScale = new THREE.Vector3();
const _probeMat = new THREE.Matrix4();
const _tangentA = new THREE.Vector3();
const _tangentB = new THREE.Vector3();

/**
 * Evaluates Earth's 3D geomagnetic dipole vector B(r) with a South Atlantic Anomaly (SAA)
 * regional attenuation for realistic geophysical telemetry.
 */
export function evaluateMagneticField(
  lat: number,
  lon: number,
  radius = EARTH_RADIUS,
  outDir = new THREE.Vector3(),
): MagneticFieldSample {
  latLonToVector3(lat, lon, radius, _posScratch);
  const r = _posScratch.length();
  _rHat.copy(_posScratch).divideScalar(Math.max(r, 1e-5));

  // Magnetic dipole formula: B(r) ∝ (3 (m · r̂) r̂ - m) / r³
  // Equatorial surface reference field B0 ≈ 30.8 µT
  const mDotR = _dipoleMoment.dot(_rHat);
  const invR3 = 1 / (r * r * r);
  const b0 = 30.8;

  _bVec
    .copy(_rHat)
    .multiplyScalar(3 * mDotR)
    .sub(_dipoleMoment)
    .multiplyScalar(b0 * invR3);

  // Subtle South Atlantic Anomaly (SAA) regional field dip centered near 26° S, 46° W
  const dLat = (lat + 26) / 22;
  const dLon = (lon + 46) / 34;
  const saaWeight = Math.exp(-(dLat * dLat + dLon * dLon));
  _bVec.multiplyScalar(1 - 0.27 * saaWeight);

  const intensityUt = _bVec.length();
  outDir.copy(_bVec).divideScalar(Math.max(intensityUt, 1e-6));

  // Local ENU (East-North-Up) frame to derive exact inclination (dip) & declination
  _east.crossVectors(_geoUp, _rHat);
  if (_east.lengthSq() < 1e-6) {
    _east.set(1, 0, 0);
  } else {
    _east.normalize();
  }
  _north.crossVectors(_rHat, _east).normalize();

  const bUp = _bVec.dot(_rHat);
  const bEast = _bVec.dot(_east);
  const bNorth = _bVec.dot(_north);
  const bHoriz = Math.hypot(bEast, bNorth);

  // Positive inclination means field points downward into the Earth (Northern Hemisphere)
  const inclinationDeg = THREE.MathUtils.radToDeg(Math.atan2(-bUp, bHoriz));
  const declinationDeg = THREE.MathUtils.radToDeg(Math.atan2(bEast, bNorth));

  return {
    intensityUt: Number(intensityUt.toFixed(1)),
    inclinationDeg: Number(inclinationDeg.toFixed(1)),
    declinationDeg: Number(declinationDeg.toFixed(1)),
    directionLocal: outDir,
  };
}

/**
 * Maps geomagnetic field intensity (µT) to a scientific perceptual ramp:
 * Low SAA (~23 µT): warm coral/amber → Mid equator (~31 µT): cyan/teal → High polar (~64 µT): luminous indigo-violet
 */
function intensityToColor(intensityUt: number, out = new THREE.Color()): THREE.Color {
  const t = THREE.MathUtils.clamp((intensityUt - 23) / (64 - 23), 0, 1);
  if (t < 0.35) {
    const k = t / 0.35;
    out.setRGB(
      THREE.MathUtils.lerp(0.96, 0.14, k),
      THREE.MathUtils.lerp(0.56, 0.84, k),
      THREE.MathUtils.lerp(0.24, 0.88, k),
    );
  } else if (t < 0.72) {
    const k = (t - 0.35) / 0.37;
    out.setRGB(
      THREE.MathUtils.lerp(0.14, 0.36, k),
      THREE.MathUtils.lerp(0.84, 0.64, k),
      THREE.MathUtils.lerp(0.88, 1.0, k),
    );
  } else {
    const k = (t - 0.72) / 0.28;
    out.setRGB(
      THREE.MathUtils.lerp(0.36, 0.72, k),
      THREE.MathUtils.lerp(0.64, 0.44, k),
      THREE.MathUtils.lerp(1.0, 1.0, k),
    );
  }
  return out;
}

/**
 * Builds a single merged unit 3D vector arrow (+Y axis aligned) for high-efficiency InstancedMesh rendering.
 */
function createArrowGeometry(): THREE.BufferGeometry {
  const shaft = new THREE.CylinderGeometry(0.0024, 0.0032, 0.052, 6);
  shaft.translate(0, 0.026, 0);

  const head = new THREE.ConeGeometry(0.0085, 0.024, 7);
  head.translate(0, 0.064, 0);

  const merged = mergeGeometries([shaft, head], false);
  shaft.dispose();
  head.dispose();
  if (!merged) {
    return new THREE.ConeGeometry(0.008, 0.065, 7);
  }
  return merged;
}

export interface MagneticFieldRig {
  group: THREE.Group;
  update: (dt: number) => void;
  setCursorProbe: (lat: number, lon: number) => MagneticFieldSample;
  hideCursorProbe: () => void;
}

/**
 * Constructs the interactive 3D Earth Magnetic Field visualization:
 *  1. Two L-shell dipole magnetosphere field-line cages (vertex-colored by field strength)
 *  2. Instanced 3D surface vector field arrows oriented along true 3D B(r) (inclination + declination)
 *  3. Animated instanced magnetic flux particles gliding along dipole field lines (S → N)
 *  4. Geomagnetic North & South pole cusp markers + auroral ovals
 *  5. Interactive cursor 3D vector probe that aligns dynamically with local B(r) on hover
 */
export function buildMagneticFieldRig(): MagneticFieldRig {
  const group = new THREE.Group();
  group.name = 'magnetic-field-layer';

  const curves: THREE.CatmullRomCurve3[] = [];
  const cTmp = new THREE.Color();

  // 1. Dipole L-Shell Field Lines (r = L * cos²(λ_m))
  const shells = [
    { L: 1.56, azimuths: 16, opacity: 0.48 },
    { L: 2.18, azimuths: 12, opacity: 0.28 },
  ];

  for (const shell of shells) {
    const surfaceCosSq = (EARTH_RADIUS * 1.004) / shell.L;
    const maxMagLat = Math.acos(Math.sqrt(Math.min(0.999, surfaceCosSq)));

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: shell.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (let a = 0; a < shell.azimuths; a++) {
      const az = (a / shell.azimuths) * Math.PI * 2 + (shell.L > 1.8 ? Math.PI / shell.azimuths : 0);
      const cosAz = Math.cos(az);
      const sinAz = Math.sin(az);

      const pts: THREE.Vector3[] = [];
      const colors: number[] = [];
      const steps = 48;

      // Trace from Southern geomagnetic hemisphere (-maxMagLat) to Northern (+maxMagLat)
      // matching true external magnetic field direction (out of South, into North)
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const magLat = THREE.MathUtils.lerp(-maxMagLat, maxMagLat, t);
        const cosL = Math.cos(magLat);
        const sinL = Math.sin(magLat);
        const r = shell.L * cosL * cosL;

        // Equatorial radial direction at azimuth az
        const p = new THREE.Vector3()
          .copy(_dipoleU)
          .multiplyScalar(cosAz * cosL)
          .addScaledVector(_dipoleV, sinAz * cosL)
          .addScaledVector(_dipoleAxis, sinL)
          .multiplyScalar(r);

        pts.push(p);

        // Approximate dipole strength along curve for color gradient (stronger near poles, softer at apex)
        const approxB = (30.8 / (r * r * r)) * Math.sqrt(1 + 3 * sinL * sinL);
        intensityToColor(approxB, cTmp);
        // Slightly fade outer apex so globe stays clear
        const apexFade = 0.65 + 0.35 * Math.abs(sinL);
        colors.push(cTmp.r * apexFade, cTmp.g * apexFade, cTmp.b * apexFade);
      }

      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const line = new THREE.Line(geo, lineMat);
      group.add(line);

      curves.push(new THREE.CatmullRomCurve3(pts));
    }
  }

  // 2. Instanced 3D Surface Vector Field Arrows (156 uniformly distributed probes)
  const arrowGeo = createArrowGeometry();
  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });

  const vectorSamples: { pos: THREE.Vector3; dir: THREE.Vector3; intensity: number }[] = [];
  const latBands = [-72, -56, -40, -24, -8, 8, 24, 40, 56, 72];
  for (const lat of latBands) {
    const lonCount = Math.max(8, Math.round(24 * Math.cos(THREE.MathUtils.degToRad(lat))));
    for (let j = 0; j < lonCount; j++) {
      const lon = -180 + ((j + 0.5) / lonCount) * 360;
      const dir = new THREE.Vector3();
      const sample = evaluateMagneticField(lat, lon, EARTH_RADIUS * 1.028, dir);
      const pos = latLonToVector3(lat, lon, EARTH_RADIUS * 1.028);
      vectorSamples.push({ pos, dir, intensity: sample.intensityUt });
    }
  }

  const vectorFieldMesh = new THREE.InstancedMesh(arrowGeo, arrowMat, vectorSamples.length);
  vectorFieldMesh.frustumCulled = false;

  for (let i = 0; i < vectorSamples.length; i++) {
    const v = vectorSamples[i];
    const scaleFactor = 0.72 + THREE.MathUtils.clamp((v.intensity - 23) / 42, 0, 1) * 0.62;
    _probeQuat.setFromUnitVectors(_geoUp, v.dir);
    _probeScale.set(scaleFactor * 0.9, scaleFactor, scaleFactor * 0.9);
    // Offset slightly back along direction so arrow centers nicely over its sample coordinate
    _posScratch.copy(v.pos).addScaledVector(v.dir, -0.025 * scaleFactor);
    _probeMat.compose(_posScratch, _probeQuat, _probeScale);
    vectorFieldMesh.setMatrixAt(i, _probeMat);

    intensityToColor(v.intensity, cTmp);
    vectorFieldMesh.setColorAt(i, cTmp);
  }
  vectorFieldMesh.instanceMatrix.needsUpdate = true;
  if (vectorFieldMesh.instanceColor) {
    vectorFieldMesh.instanceColor.needsUpdate = true;
  }
  group.add(vectorFieldMesh);

  // 3. Animated Flux Quanta Gliding Along Dipole Field Lines (South → North)
  const particlesPerCurve = 2;
  const totalParticles = curves.length * particlesPerCurve;
  const fluxGeo = new THREE.ConeGeometry(0.0075, 0.028, 6);
  const fluxMat = new THREE.MeshBasicMaterial({
    color: 0xa5f3fc,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const fluxMesh = new THREE.InstancedMesh(fluxGeo, fluxMat, totalParticles);
  fluxMesh.frustumCulled = false;

  const fluxPhases = new Float32Array(totalParticles);
  const fluxSpeeds = new Float32Array(totalParticles);
  for (let i = 0; i < totalParticles; i++) {
    fluxPhases[i] = ((i % particlesPerCurve) / particlesPerCurve + (i * 0.17) % 1) % 1;
    fluxSpeeds[i] = 0.11 + ((i * 29) % 11) * 0.008;
  }
  group.add(fluxMesh);

  // 4. Geomagnetic North & South Pole Cusp Rings + Auroral Ovals
  const addMagneticPoleRing = (hemisphereSign: 1 | -1, hexColor: number) => {
    const auroraLat = THREE.MathUtils.degToRad(69 * hemisphereSign);
    const cosL = Math.cos(auroraLat);
    const sinL = Math.sin(auroraLat);
    const r = EARTH_RADIUS * 1.016;
    const ringPts: THREE.Vector3[] = [];
    const segs = 64;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const p = new THREE.Vector3()
        .copy(_dipoleU)
        .multiplyScalar(Math.cos(a) * cosL)
        .addScaledVector(_dipoleV, Math.sin(a) * cosL)
        .addScaledVector(_dipoleAxis, sinL)
        .multiplyScalar(r);
      ringPts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(ringPts);
    const mat = new THREE.LineBasicMaterial({
      color: hexColor,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    group.add(new THREE.Line(geo, mat));

    // Dipole axis pole marker spike
    const poleDir = _dipoleAxis.clone().multiplyScalar(hemisphereSign);
    const polePos = poleDir.clone().multiplyScalar(EARTH_RADIUS * 1.006);
    const spikeGeo = new THREE.CylinderGeometry(0.0028, 0.0028, 0.14, 8);
    spikeGeo.translate(0, 0.07, 0);
    const spike = new THREE.Mesh(
      spikeGeo,
      new THREE.MeshBasicMaterial({
        color: hexColor,
        transparent: true,
        opacity: 0.85,
      }),
    );
    spike.position.copy(polePos);
    spike.quaternion.setFromUnitVectors(_geoUp, poleDir);
    group.add(spike);
  };

  addMagneticPoleRing(1, 0x818cf8); // North magnetic pole (field enters)
  addMagneticPoleRing(-1, 0x2dd4bf); // South magnetic pole (field emerges)

  // 5. Interactive Live Cursor 3D Vector Probe (shown when hovering over globe while Magnetic Field is active)
  const cursorProbeGroup = new THREE.Group();
  cursorProbeGroup.visible = false;

  const probeArrowMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
  });
  const probeArrow = new THREE.Mesh(arrowGeo.clone(), probeArrowMat);
  probeArrow.scale.set(2.1, 2.5, 2.1);
  cursorProbeGroup.add(probeArrow);

  const probeRingGeo = new THREE.RingGeometry(0.022, 0.03, 28);
  probeRingGeo.rotateX(-Math.PI / 2);
  const probeRingMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const probeRing = new THREE.Mesh(probeRingGeo, probeRingMat);
  cursorProbeGroup.add(probeRing);

  group.add(cursorProbeGroup);

  const update = (dt: number) => {
    if (!group.visible) return;

    for (let i = 0; i < totalParticles; i++) {
      fluxPhases[i] = (fluxPhases[i] + dt * fluxSpeeds[i]) % 1;
      const curve = curves[Math.floor(i / particlesPerCurve)];
      const t = fluxPhases[i];
      curve.getPoint(t, _tangentA);
      curve.getTangent(t, _tangentB).normalize();

      const fadeScale = Math.sin(t * Math.PI);
      _probeQuat.setFromUnitVectors(_geoUp, _tangentB);
      _probeScale.setScalar(0.55 + fadeScale * 0.65);
      _probeMat.compose(_tangentA, _probeQuat, _probeScale);
      fluxMesh.setMatrixAt(i, _probeMat);
    }
    fluxMesh.instanceMatrix.needsUpdate = true;
  };

  const setCursorProbe = (lat: number, lon: number): MagneticFieldSample => {
    const sample = evaluateMagneticField(lat, lon, EARTH_RADIUS * 1.022, _tangentB);
    latLonToVector3(lat, lon, EARTH_RADIUS * 1.008, _tangentA);

    cursorProbeGroup.position.copy(_tangentA);
    cursorProbeGroup.visible = true;

    // Orient base ring flush to Earth surface normal
    _rHat.copy(_tangentA).normalize();
    probeRing.quaternion.setFromUnitVectors(_geoUp, _rHat);

    // Orient 3D arrow directly along true 3D local magnetic vector B(r)
    probeArrow.quaternion.setFromUnitVectors(_geoUp, sample.directionLocal);
    probeArrow.position.copy(_rHat).multiplyScalar(0.012);

    intensityToColor(sample.intensityUt, cTmp);
    probeArrowMat.color.copy(cTmp);
    probeRingMat.color.copy(cTmp);

    return sample;
  };

  const hideCursorProbe = () => {
    cursorProbeGroup.visible = false;
  };

  group.visible = false;

  return {
    group,
    update,
    setCursorProbe,
    hideCursorProbe,
  };
}
