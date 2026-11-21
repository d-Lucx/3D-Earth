import * as THREE from 'three';
import type { OrbitalSatellite } from '../data/earthData';

let sharedSolarTexture: THREE.CanvasTexture | null = null;

function getSolarArrayTexture(): THREE.CanvasTexture {
  if (sharedSolarTexture) return sharedSolarTexture;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0d2248';
  ctx.fillRect(0, 0, 128, 64);

  // Photovoltaic cell grid
  ctx.strokeStyle = '#38bdf8';
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (let x = 0; x <= 128; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 64);
    ctx.stroke();
  }
  for (let y = 0; y <= 64; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(128, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  sharedSolarTexture = tex;
  return tex;
}

/**
 * Builds a composite multi-part (7-10 parts) procedural 3D satellite model
 * with varied PBR roughness/metalness (gold Kapton foil, anodized titanium,
 * glossy solar arrays, and matte radiator/optical baffles).
 */
export function buildSatelliteMesh(sat: OrbitalSatellite): {
  group: THREE.Group;
  hitProxy: THREE.Mesh;
} {
  const group = new THREE.Group();
  group.name = `satellite-${sat.id}`;

  const solarTex = getSolarArrayTexture();

  const goldFoilMat = new THREE.MeshStandardMaterial({
    color: 0xd9a441,
    metalness: 0.9,
    roughness: 0.24,
  });

  const titaniumMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.82,
    roughness: 0.32,
  });

  const matteCarbonMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.18,
    roughness: 0.78,
  });

  const solarWingMat = new THREE.MeshStandardMaterial({
    map: solarTex,
    color: 0x2563eb,
    metalness: 0.65,
    roughness: 0.22,
    emissive: new THREE.Color(sat.accentColor),
    emissiveIntensity: 0.14,
  });

  const beaconMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(sat.accentColor),
    emissive: new THREE.Color(sat.accentColor),
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0.1,
  });

  if (sat.id === 'iss') {
    // ISS-style truss + pressurized habitation modules + quad dual-wing solar arrays
    const truss = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.006, 0.006), titaniumMat);
    group.add(truss);

    const coreModule = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.007, 0.044, 12),
      titaniumMat,
    );
    coreModule.rotation.x = Math.PI / 2;
    group.add(coreModule);

    const nodeHub = new THREE.Mesh(new THREE.OctahedronGeometry(0.009, 1), goldFoilMat);
    group.add(nodeHub);

    const labModule = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0055, 0.0055, 0.028, 10),
      matteCarbonMat,
    );
    labModule.rotation.z = Math.PI / 2;
    labModule.position.set(0, 0, 0.012);
    group.add(labModule);

    // 4 pairs of large golden-copper/blue solar wings along the truss
    const wingOffsets = [-0.036, -0.022, 0.022, 0.036];
    for (const xPos of wingOffsets) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.0018, 0.046), solarWingMat);
      wing.position.set(xPos, 0, 0);
      group.add(wing);
    }

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 10, 10), beaconMat);
    beacon.position.set(0, 0.011, 0);
    group.add(beacon);
  } else {
    // Earth-observation / Space Telescope spacecraft (bus, gold thermal drum, dish, optical baffle, twin articulated solar wings)
    // 1. Primary satellite bus
    const bus = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.011, 0.026, 8), goldFoilMat);
    bus.rotation.x = Math.PI / 2;
    group.add(bus);

    // 2. Forward optical telescope / sensor baffle
    const baffle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.0095, 0.014, 12),
      matteCarbonMat,
    );
    baffle.rotation.x = Math.PI / 2;
    baffle.position.z = 0.018;
    group.add(baffle);

    // 3. Aperture ring trim
    const apertureRing = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0012, 8, 16), titaniumMat);
    apertureRing.position.z = 0.025;
    group.add(apertureRing);

    // 4. Aft propulsion nozzle
    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.0065, 0.008, 10),
      titaniumMat,
    );
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = -0.016;
    group.add(nozzle);

    // 5. High-gain parabolic comms dish (LatheGeometry)
    const dishPoints = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.004, 0.0012),
      new THREE.Vector2(0.0085, 0.0042),
    ];
    const dishGeo = new THREE.LatheGeometry(dishPoints, 12);
    const dish = new THREE.Mesh(dishGeo, titaniumMat);
    dish.position.set(0, 0.014, -0.003);
    dish.rotation.x = -0.35;
    group.add(dish);

    // 6 & 7. Twin articulated solar array wings + support yoke bars
    const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.068, 6), titaniumMat);
    yoke.rotation.z = Math.PI / 2;
    group.add(yoke);

    const leftWing = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.0016, 0.015), solarWingMat);
    leftWing.position.set(-0.024, 0, 0);
    group.add(leftWing);

    const rightWing = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.0016, 0.015), solarWingMat);
    rightWing.position.set(0.024, 0, 0);
    group.add(rightWing);

    // 8. Telemetry transponder beacon
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.0036, 10, 10), beaconMat);
    beacon.position.set(0, -0.012, 0.004);
    group.add(beacon);
  }

  // Invisible raycasting hit proxy sphere on layer 1 for effortless selection
  const hitProxy = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 10, 10),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitProxy.layers.set(1);
  hitProxy.userData = { kind: 'satellite', id: sat.id };
  group.add(hitProxy);

  return { group, hitProxy };
}

export function disposeSharedSatelliteAssets() {
  if (sharedSolarTexture) {
    sharedSolarTexture.dispose();
    sharedSolarTexture = null;
  }
}
