// Procedural vehicle models. Every diagnosable part is a named Object3D (`userData.componentId`)
// whose id matches the knowledge base / maintenance data (e.g. "coil_2", "catalytic_converter").
// No external asset: works offline and weighs nothing.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export interface VehicleSpec {
  type: string; // car | van | motorcycle | truck
  cylinders: number;
  fuel: string; // petrol | diesel | hybrid | electric
  traction?: string; // front | rear | both (electric vehicles)
  make?: string;
}

export const PALETTE = {
  metal: 0x8a94a6,
  dark: 0x2a3140,
  rubber: 0x1a1d24,
  copper: 0xc07a45,
  plastic: 0x3b4252,
  blue: 0x3b82f6,
  green: 0x22c55e,
  yellow: 0xeab308,
  exhaust: 0x6b5a4e,
};

export function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.5, ...opts });
}

type Builder = {
  root: THREE.Group;
  add(id: string, obj: THREE.Object3D): THREE.Object3D;
};

function builder(): Builder {
  const root = new THREE.Group();
  const groups = new Map<string, THREE.Group>();
  return {
    root,
    add(id, obj) {
      let g = groups.get(id);
      if (!g) {
        g = new THREE.Group();
        g.name = id;
        g.userData.componentId = id;
        groups.set(id, g);
        root.add(g);
      }
      obj.traverse((o) => (o.userData.componentId = id));
      g.add(obj);
      return obj;
    },
  };
}

const box = (w: number, h: number, d: number, color: number, r = 0.02) =>
  new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), mat(color));
const cyl = (rt: number, rb: number, h: number, color: number, seg = 20) =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
/** Applies rotation / scale (Object3D transforms are read-only properties, so no Object.assign). */
function tf<T extends THREE.Object3D>(o: T, t: { rotation?: number[]; scale?: number[] }): T {
  if (t.rotation) o.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
  if (t.scale) o.scale.set(t.scale[0], t.scale[1], t.scale[2]);
  return o;
}
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => {
  o.position.set(x, y, z);
  return o;
};

function tube(points: [number, number, number][], radius: number, color: number) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 10, false), mat(color, { roughness: 0.7 }));
}

function wheel(radius: number, width: number, outward = true) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.76, radius * 0.25, 20, 56), mat(PALETTE.rubber, { metalness: 0, roughness: 0.92 }));
  tyre.scale.z = width / (radius * 0.5);
  const rimMat = mat(0xb8c0cc, { metalness: 0.85, roughness: 0.25 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.56, radius * 0.56, width * 0.75, 40, 1, true), rimMat);
  barrel.rotation.x = Math.PI / 2;
  const face = outward ? 1 : -1;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.13, radius * 0.15, 0.04, 24), rimMat);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = face * width * 0.3;
  g.add(tyre, barrel, hub);
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(new RoundedBoxGeometry(radius * 0.46, radius * 0.11, 0.035, 2, 0.01), rimMat);
    const a = (i / 5) * Math.PI * 2;
    spoke.position.set(Math.cos(a) * radius * 0.33, Math.sin(a) * radius * 0.33, face * width * 0.28);
    spoke.rotation.z = a;
    g.add(spoke);
  }
  return g;
}

function brakeDisc(radius: number, scale = 1) {
  const g = new THREE.Group();
  const d = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5 * scale, radius * 0.5 * scale, 0.028, 40), mat(0xb4b9c2, { metalness: 0.9, roughness: 0.35 }));
  d.rotation.x = Math.PI / 2;
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.2, radius * 0.2, 0.05, 24), mat(0x6b7280));
  hat.rotation.x = Math.PI / 2;
  const caliper = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.17 * scale, 0.09, 3, 0.025), mat(0xc81e1e, { metalness: 0.3, roughness: 0.45 }));
  caliper.position.set(radius * 0.32, radius * 0.27, 0);
  g.add(d, hat, caliper);
  return g;
}

/** Translucent body shell with glowing edges (X-ray look). */
function shell(profile: [number, number][], width: number, color = 0x7dd3fc) {
  const shape = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 4, curveSegments: 16 });
  geo.translate(0, 0, -width / 2);
  const fill = new THREE.Mesh(
    geo,
    new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: 0.07, roughness: 0.1, metalness: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }));
  const g = new THREE.Group();
  g.add(fill, edges);
  g.userData.isShell = true;
  g.traverse((x) => (x.userData.shell = true));
  return g;
}

/** Engine with N inline cylinders along Z, centred at (x, y, 0). */
function engine(b: Builder, x: number, y: number, n: number, fuel: string, scale = 1) {
  const pitch = 0.11 * scale;
  const len = Math.max(n * pitch + 0.12 * scale, 0.36 * scale);
  b.add('engine', at(box(0.42 * scale, 0.38 * scale, len, PALETTE.dark, 0.04), x, y, 0));
  b.add('engine', at(box(0.36 * scale, 0.12 * scale, len * 0.95, 0x4b5563, 0.04), x, y + 0.25 * scale, 0)); // head
  b.add('oil_filler_cap', at(cyl(0.035 * scale, 0.035 * scale, 0.03, PALETTE.yellow), x - 0.08 * scale, y + 0.33 * scale, len * 0.3));
  b.add('dipstick', at(cyl(0.012, 0.012, 0.32 * scale, PALETTE.yellow), x + 0.16 * scale, y + 0.18 * scale, -len * 0.35));
  b.add('oil_drain_plug', at(cyl(0.025, 0.025, 0.03, 0xd4d4d8), x, y - 0.3 * scale, 0));
  b.add('engine', at(box(0.36 * scale, 0.1 * scale, len * 0.8, 0x374151), x, y - 0.24 * scale, 0)); // oil pan
  b.add('oil_filter', at(cyl(0.045 * scale, 0.045 * scale, 0.1 * scale, 0x2563eb), x + 0.25 * scale, y - 0.08 * scale, len * 0.25));
  b.add('oil_pressure_sensor', at(cyl(0.015, 0.015, 0.05, 0xf59e0b), x + 0.23 * scale, y - 0.02 * scale, len * 0.05));
  b.add('knock_sensor', at(cyl(0.022, 0.022, 0.03, 0x10b981), x - 0.22 * scale, y - 0.02 * scale, 0));
  b.add('crank_sensor', at(cyl(0.015, 0.015, 0.06, 0x10b981), x + 0.15 * scale, y - 0.2 * scale, -len / 2));
  b.add('cam_sensor', at(cyl(0.015, 0.015, 0.05, 0x10b981), x - 0.1 * scale, y + 0.3 * scale, -len / 2 + 0.02));
  b.add('vvt_solenoid', at(cyl(0.02, 0.02, 0.06, 0x8b5cf6), x + 0.08 * scale, y + 0.3 * scale, -len / 2 + 0.02));
  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.16 * scale, 0.012, 8, 40), mat(0xa1a1aa));
  chain.scale.y = 1.4;
  b.add('timing_chain', at(chain, x, y + 0.05 * scale, -len / 2 - 0.02));
  b.add('thermostat', at(cyl(0.035, 0.035, 0.05, 0x06b6d4), x + 0.2 * scale, y + 0.22 * scale, -len / 2 + 0.06));
  b.add('coolant_temp_sensor', at(cyl(0.012, 0.012, 0.05, 0x06b6d4), x + 0.2 * scale, y + 0.26 * scale, -len / 2 + 0.12));

  for (let i = 1; i <= n; i++) {
    const z = -((n - 1) * pitch) / 2 + (i - 1) * pitch;
    const c = cyl(0.045 * scale, 0.045 * scale, 0.26 * scale, 0x94a3b8);
    (c.material as THREE.MeshStandardMaterial).transparent = true;
    (c.material as THREE.MeshStandardMaterial).opacity = 0.85;
    b.add(`cylinder_${i}`, at(c, x, y + 0.02, z));
    if (fuel === 'diesel') {
      b.add('glow_plugs', at(cyl(0.008, 0.008, 0.12, PALETTE.copper), x - 0.06 * scale, y + 0.33 * scale, z));
    } else {
      b.add(`spark_plug_${i}`, at(cyl(0.01, 0.01, 0.12, 0xe5e7eb), x, y + 0.3 * scale, z));
      b.add(`coil_${i}`, at(box(0.06, 0.12 * scale, 0.05, 0x111827, 0.01), x, y + 0.4 * scale, z));
    }
    const inj = cyl(0.012, 0.012, 0.12, 0x84cc16);
    inj.rotation.z = Math.PI / 5;
    b.add(`injector_${i}`, at(inj, x - 0.17 * scale, y + 0.22 * scale, z));
  }
  b.add('fuel_rail', at(tf(cyl(0.018, 0.018, len * 0.9, 0x65a30d), { rotation: [Math.PI / 2, 0, 0] }), x - 0.21 * scale, y + 0.27 * scale, 0));
  return len;
}

function addHeadlights(b: Builder, x: number, y: number, zs: number[]) {
  for (const z of zs) {
    const l = box(0.05, 0.1, 0.24, 0xfef9c3, 0.03);
    (l.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xfef3c7);
    (l.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
    b.add('headlights', at(l, x, y, z));
  }
}

/** Paint colour derived from the make (stable, tasteful palette). */
function paintFor(make: string): number {
  const palette = [0x1f3b73, 0x7a8796, 0xd9dde3, 0x3a3f47, 0x8c1c24, 0x1d5c63, 0x4b5f3a, 0x2c2c34, 0xb7c3cf];
  const known: Record<string, number> = { Tesla: 0xe8ecf1, Renault: 0x2a4f8f, Peugeot: 0x3a3f47, Dacia: 0x6b7a5a, Kia: 0x1d5c63, Toyota: 0xb7c3cf, BMW: 0x1f3b73, Volkswagen: 0x7a8796 };
  if (known[make]) return known[make];
  let h = 0;
  for (const c of make) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

/** Realistic body: painted lower body with wheel arches + tinted greenhouse, and a ghost (X-ray) twin. */
function carBody(o: { L: number; W: number; wr: number; axleF: number; axleR: number; big: boolean; paint: number }) {
  const { L, W, wr, axleF, axleR, big } = o;
  const low = 0.3;
  const belt = big ? 1.22 : 1.04;
  const roof = big ? 2.02 : 1.5;
  const hoodEnd = big ? L - 0.6 : L - 0.9;
  const r = wr + 0.08;

  const lower = new THREE.Shape();
  lower.moveTo(-L + 0.1, low);
  lower.lineTo(axleR - r, low);
  lower.absarc(axleR, wr, r, Math.PI, 0, true);
  lower.lineTo(axleF - r, low);
  lower.absarc(axleF, wr, r, Math.PI, 0, true);
  lower.lineTo(L - 0.14, low);
  lower.quadraticCurveTo(L + 0.03, low, L, 0.52);
  lower.quadraticCurveTo(L - 0.02, belt - 0.1, L - 0.32, belt - 0.03);
  lower.lineTo(hoodEnd, belt);
  lower.lineTo(-L + 0.22, belt + 0.03);
  lower.quadraticCurveTo(-L + 0.02, belt, -L, belt - 0.22);
  lower.lineTo(-L, low + 0.12);
  lower.quadraticCurveTo(-L, low, -L + 0.1, low);

  const glass = new THREE.Shape();
  const wTop = big ? L - 0.95 : L - 1.62;
  const rTop = big ? -L + 0.12 : -L + 0.72;
  glass.moveTo(hoodEnd, belt - 0.01);
  glass.quadraticCurveTo(hoodEnd - 0.1, belt + 0.1, wTop, roof - 0.04);
  glass.quadraticCurveTo(wTop - 0.08, roof, wTop - 0.25, roof);
  glass.lineTo(rTop + 0.15, roof);
  glass.quadraticCurveTo(rTop, roof - 0.02, rTop - 0.05, roof - 0.12);
  glass.lineTo(-L + 0.16, belt + 0.03);
  glass.lineTo(hoodEnd, belt - 0.01);

  const ext = (s: THREE.Shape, depth: number, bevel: number) => {
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 5, curveSegments: 24 });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  const lowerGeo = ext(lower, W * 2 - 0.16, 0.08);
  const glassGeo = ext(glass, W * 2 - 0.36, 0.08);

  const solid = new THREE.Group();
  solid.userData.solidShell = true;
  const paint = new THREE.MeshPhysicalMaterial({ color: o.paint, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  const tint = new THREE.MeshPhysicalMaterial({ color: 0x0b1220, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.78, clearcoat: 1 });
  const roofMat = new THREE.MeshPhysicalMaterial({ color: o.paint, metalness: 0.55, roughness: 0.32, clearcoat: 1 });
  solid.add(new THREE.Mesh(lowerGeo, paint), new THREE.Mesh(glassGeo, tint));
  // Roof panel over the greenhouse
  const roofPanel = new THREE.Mesh(new RoundedBoxGeometry(Math.abs(wTop - 0.25 - (rTop + 0.15)) + 0.1, 0.05, W * 2 - 0.3, 3, 0.02), roofMat);
  roofPanel.position.set((wTop - 0.25 + rTop + 0.15) / 2, roof + 0.07, 0);
  solid.add(roofPanel);
  // Tail lights and grille
  for (const z of [W - 0.3, -W + 0.3]) {
    const tl = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.08, 0.32, 2, 0.02), new THREE.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0xdc2626, emissiveIntensity: 0.7 }));
    tl.position.set(-L - 0.03, belt - 0.12, z);
    solid.add(tl);
  }
  const grille = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.12, W * 1.1, 2, 0.02), new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.6 }));
  grille.position.set(L + 0.04, 0.5, 0);
  solid.add(grille);
  // Side mirrors
  for (const side of [1, -1]) {
    const mr = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.08, 0.14, 2, 0.03), paint);
    mr.position.set(hoodEnd - 0.08, belt + 0.1, side * (W + 0.02));
    solid.add(mr);
  }

  const ghost = new THREE.Group();
  ghost.userData.isShell = true;
  for (const geo of [lowerGeo, glassGeo]) {
    ghost.add(
      new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.06, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide })),
      new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.4 })),
    );
  }
  const g = new THREE.Group();
  g.add(solid, ghost);
  g.traverse((x) => (x.userData.shell = true));
  return g;
}

/** Chassis parts common to all cars: hubs/bearings, shocks + springs, drive shafts. */
function chassis(b: Builder, o: { W: number; wr: number; axleF: number; axleR: number; driven: 'front' | 'rear' | 'both' }) {
  const { W, wr, axleF, axleR } = o;
  const corners: [string, number, number][] = [['fl', axleF, W - 0.05], ['fr', axleF, -W + 0.05], ['rl', axleR, W - 0.05], ['rr', axleR, -W + 0.05]];
  for (const [s, x, z] of corners) {
    const sz = Math.sign(z);
    b.add(`wheel_bearing_${s}`, at(tf(cyl(0.07, 0.07, 0.07, 0x9ca3af, 20), { rotation: [Math.PI / 2, 0, 0] }), x, wr, z - sz * 0.2));
    // Shock absorber with coil spring
    const shockX = x + (x > 0 ? -0.06 : 0.06);
    const zS = z - sz * 0.27;
    b.add(`shock_${s}`, at(cyl(0.03, 0.03, 0.5, 0x52525b), shockX, wr + 0.32, zS));
    b.add(`shock_${s}`, at(cyl(0.018, 0.018, 0.2, 0xd4d4d8), shockX, wr + 0.63, zS));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 90; i++) {
      const a = (i / 90) * Math.PI * 2 * 6;
      pts.push(new THREE.Vector3(shockX + Math.cos(a) * 0.065, wr + 0.12 + (i / 90) * 0.42, zS + Math.sin(a) * 0.065));
    }
    b.add(`shock_${s}`, new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.011, 6, false), mat(0xdc2626, { metalness: 0.3, roughness: 0.4 })));
  }
  const shafts: [string, number, number][] = [];
  if (o.driven !== 'rear') shafts.push(['fl', axleF, 1], ['fr', axleF, -1]);
  if (o.driven !== 'front') shafts.push(['rl', axleR, 1], ['rr', axleR, -1]);
  for (const [s, x, side] of shafts) {
    const zIn = side * 0.14;
    const zOut = side * (W - 0.28);
    b.add(`cv_joint_${s}`, tube([[x, wr + 0.02, zIn], [x, wr, zOut]], 0.022, 0x6b7280));
    for (const [zz, rr] of [[zIn + side * 0.05, 0.05], [zOut - side * 0.03, 0.055]] as [number, number][]) {
      b.add(`cv_joint_${s}`, at(tf(cyl(rr * 0.55, rr, 0.1, 0x111827, 14), { rotation: [Math.PI / 2, 0, 0] }), x, wr + 0.01, zz));
    }
  }
}

function evPowertrain(b: Builder, o: { L: number; W: number; wr: number; axleF: number; axleR: number; driven: 'front' | 'rear' | 'both' }) {
  const { L, W, wr, axleF, axleR } = o;
  const len = axleF - axleR - 0.85;
  const cx = (axleF + axleR) / 2 - 0.05;
  // Traction battery: flat pack under the floor with visible modules
  b.add('hv_battery', at(box(len, 0.13, W * 2 - 0.3, 0x374151, 0.03), cx, 0.25, 0));
  const nx = Math.max(3, Math.round(len / 0.32));
  for (let i = 0; i < nx; i++) {
    for (const z of [-0.33, 0.33]) {
      b.add('hv_battery', at(box(len / nx - 0.04, 0.04, 0.56, 0x1f2937, 0.01), cx - len / 2 + (i + 0.5) * (len / nx), 0.335, z));
    }
  }
  b.add('battery_coolant', tube([[cx - len / 2 + 0.05, 0.27, W - 0.2], [cx + len / 2 - 0.05, 0.27, W - 0.2], [axleF - 0.2, 0.55, W - 0.3]], 0.012, 0x38bdf8));
  b.add('battery_coolant', tube([[cx - len / 2 + 0.05, 0.27, -W + 0.2], [cx + len / 2 - 0.05, 0.27, -W + 0.2], [axleF - 0.2, 0.55, -W + 0.3]], 0.012, 0x38bdf8));
  b.add('coolant_reservoir', at(box(0.12, 0.12, 0.14, 0xe0f2fe, 0.03), axleF + 0.15, 0.85, W - 0.3));

  const units = o.driven === 'both' ? [axleF, axleR] : [o.driven === 'rear' ? axleR : axleF];
  for (const ax of units) {
    const dir = ax > 0 ? 1 : -1;
    b.add('drive_motor', at(tf(cyl(0.14, 0.14, 0.34, 0x9ca3af, 28), { rotation: [Math.PI / 2, 0, 0] }), ax + dir * 0.02, wr + 0.04, -0.14));
    b.add('drive_motor', at(tf(cyl(0.145, 0.145, 0.02, 0x22d3ee, 28), { rotation: [Math.PI / 2, 0, 0] }), ax + dir * 0.02, wr + 0.04, 0.03));
    b.add('reducer', at(box(0.3, 0.3, 0.16, 0x52525b, 0.05), ax + dir * 0.02, wr + 0.04, 0.13));
    b.add('inverter', at(box(0.32, 0.1, 0.36, 0x475569, 0.03), ax + dir * 0.02, wr + 0.25, -0.05));
    b.add('hv_cables', tube([[cx + dir * (len / 2 - 0.05), 0.33, 0.1], [ax - dir * 0.15, 0.45, 0.05], [ax + dir * 0.02, wr + 0.25, -0.05]], 0.018, 0xf97316));
    b.add('hv_cables', tube([[cx + dir * (len / 2 - 0.05), 0.33, -0.12], [ax - dir * 0.15, 0.47, -0.15], [ax + dir * 0.02, wr + 0.27, -0.2]], 0.018, 0xf97316));
  }
  const fx = axleF + 0.15;
  b.add('onboard_charger', at(box(0.28, 0.1, 0.24, 0x334155, 0.02), fx, 0.78, 0.3));
  b.add('dc_dc_converter', at(box(0.16, 0.08, 0.14, 0x0f766e, 0.02), fx, 0.78, -0.05));
  b.add('heat_pump', at(box(0.18, 0.16, 0.18, 0x6b7280, 0.03), fx + 0.25, 0.7, -0.35));
  b.add('hv_cables', tube([[cx + len / 2 - 0.05, 0.33, 0.3], [fx - 0.2, 0.6, 0.35], [fx, 0.78, 0.3]], 0.014, 0xf97316));
  b.add('hv_cables', tube([[fx, 0.78, 0.3], [fx + 0.1, 0.75, -0.2], [fx + 0.25, 0.7, -0.35]], 0.01, 0xf97316));
  b.add('charge_port', at(tf(cyl(0.06, 0.06, 0.03, 0x111827, 20), { rotation: [Math.PI / 2, 0, 0] }), axleR + 0.15, 0.85, -W + 0.01));
  b.add('hv_cables', tube([[axleR + 0.15, 0.85, -W + 0.05], [axleR + 0.3, 0.5, -W + 0.3], [cx - len / 2 + 0.1, 0.33, -0.3]], 0.012, 0xf97316));
  void L;
}

function carLike(spec: VehicleSpec, big: boolean): THREE.Group {
  const b = builder();
  const L = big ? 2.55 : 2.15; // half length
  const W = big ? 0.95 : 0.85;
  const wr = big ? 0.36 : 0.33;
  const axleF = L - 0.75;
  const axleR = -L + (big ? 0.85 : 0.7);
  const electric = spec.fuel === 'electric';
  b.root.add(carBody({ L, W, wr, axleF, axleR, big, paint: paintFor(spec.make ?? '') }));

  const corners: [string, number, number][] = [['fl', axleF, W - 0.05], ['fr', axleF, -W + 0.05], ['rl', axleR, W - 0.05], ['rr', axleR, -W + 0.05]];
  for (const [s, x, z] of corners) {
    b.add(`wheel_${s}`, at(wheel(wr, 0.22, z > 0), x, wr, z));
    b.add(`wheel_speed_sensor_${s}`, at(box(0.04, 0.06, 0.04, 0x10b981, 0.01), x - 0.12, wr + 0.12, z - Math.sign(z) * 0.14));
    b.add(`brake_${s}`, at(brakeDisc(wr, s.startsWith('r') ? 0.85 : 1), x, wr, z - Math.sign(z) * 0.13));
  }
  const driven: 'front' | 'rear' | 'both' = electric ? ((spec.traction as 'front' | 'rear' | 'both') || 'front') : 'front';
  chassis(b, { W, wr, axleF, axleR, driven });

  const ex = axleF + 0.05;
  const ey = 0.58;
  // Common to all energies
  b.add('radiator', at(box(0.06, 0.42, W * 1.5, 0x64748b, 0.02), L - 0.22, 0.68, 0));
  b.add('cooling_fan', at(tf(cyl(0.18, 0.18, 0.05, 0x1f2937, 24), { rotation: [0, 0, Math.PI / 2] }), L - 0.3, 0.68, -0.2));
  b.add('brake_fluid_reservoir', at(box(0.08, 0.08, 0.1, 0xfef08a, 0.02), ex - 0.48, ey + 0.32, W - 0.35));
  b.add('washer_reservoir', at(box(0.14, 0.18, 0.14, 0x60a5fa, 0.03), L - 0.35, 0.65, W - 0.28));
  b.add('battery', at(box(0.24, 0.18, 0.17, 0x111827, 0.02), ex - 0.15, ey + 0.06, -W + 0.28));
  b.add('battery', at(cyl(0.015, 0.015, 0.03, 0xef4444), ex - 0.08, ey + 0.17, -W + 0.24));
  b.add('ecu', at(box(0.2, 0.05, 0.16, 0x0f766e, 0.01), ex - 0.55, ey + 0.2, -W + 0.3));
  b.add('abs_module', at(box(0.14, 0.12, 0.12, 0x6b7280, 0.02), ex - 0.5, ey + 0.1, W - 0.2));
  b.add('cabin_filter', at(box(0.22, 0.03, 0.3, 0xfde68a, 0.01), ex - 0.62, ey + 0.38, 0));
  addHeadlights(b, L - 0.05, 0.72, [W - 0.25, -W + 0.25]);
  const wiper = box(0.03, 0.02, 0.5, 0x0f172a, 0.005);
  wiper.rotation.z = -0.5;
  b.add('wiper_blades', at(wiper, big ? L - 0.66 : L - 0.93, big ? 1.26 : 1.08, 0.2));
  b.add('wiper_blades', at(wiper.clone(), big ? L - 0.66 : L - 0.93, big ? 1.26 : 1.08, -0.35));
  b.add('cabin', at(box(0.3, 0.18, W * 1.6, 0x1e293b, 0.05), ex - 1.0, 0.95, 0));
  b.add('cabin', at(box(0.45, 0.08, 0.45, 0x1e293b, 0.04), ex - 1.55, 0.55, 0.38));
  b.add('cabin', at(box(0.45, 0.08, 0.45, 0x1e293b, 0.04), ex - 1.55, 0.55, -0.38));
  b.add('can_bus', tube([[ex - 0.55, ey + 0.2, -W + 0.3], [ex - 0.9, 0.9, -0.2], [ex - 1.0, 0.95, 0.3], [ex - 0.5, ey + 0.1, W - 0.2]], 0.01, 0xf59e0b));
  b.add('can_bus', tube([[ex - 1.0, 0.95, 0], [axleR + 0.3, 0.6, 0.0], [axleR, wr + 0.2, W - 0.2]], 0.01, 0xf59e0b));

  if (electric) {
    evPowertrain(b, { L, W, wr, axleF, axleR, driven });
    return b.root;
  }

  // ---- Combustion / hybrid powertrain (transverse engine)
  engine(b, ex, ey, spec.cylinders, spec.fuel);
  b.add('transmission', at(box(0.42, 0.34, 0.32, 0x52525b, 0.05), ex - 0.05, 0.6, Math.max(spec.cylinders * 0.055, 0.2) + 0.3));
  b.add('vehicle_speed_sensor', at(cyl(0.02, 0.02, 0.06, 0x10b981), ex - 0.25, 0.55, 0.5));
  b.add('intake_manifold', at(box(0.14, 0.12, spec.cylinders * 0.11 + 0.05, 0x334155, 0.04), ex - 0.3, ey + 0.18, 0));
  b.add('map_sensor', at(box(0.04, 0.03, 0.04, 0x10b981, 0.01), ex - 0.33, ey + 0.27, 0.12));
  b.add('throttle_body', at(tf(cyl(0.05, 0.05, 0.08, 0x9ca3af), { rotation: [Math.PI / 2, 0, 0] }), ex - 0.3, ey + 0.2, spec.cylinders * 0.055 + 0.1));
  b.add('air_filter', at(box(0.32, 0.14, 0.26, 0x1f2937, 0.04), ex + 0.25, ey + 0.32, -W + 0.32));
  b.add('maf_sensor', at(tf(cyl(0.045, 0.045, 0.1, 0xf97316), { rotation: [Math.PI / 2, 0, 0] }), ex + 0.08, ey + 0.32, -W + 0.52));
  b.add('iat_sensor', at(cyl(0.01, 0.01, 0.04, 0xf97316), ex + 0.08, ey + 0.38, -W + 0.52));
  b.add('vacuum_hoses', tube([[ex + 0.05, ey + 0.32, -W + 0.6], [ex - 0.15, ey + 0.36, -0.1], [ex - 0.3, ey + 0.26, spec.cylinders * 0.055 + 0.1]], 0.04, 0x111827));
  b.add('vacuum_hoses', tube([[ex - 0.36, ey + 0.26, -0.1], [ex - 0.25, ey + 0.4, -0.2], [ex - 0.05, ey + 0.36, -0.15]], 0.012, 0x111827));
  b.add('purge_valve', at(cyl(0.025, 0.025, 0.05, 0x22c55e), ex - 0.4, ey + 0.32, -0.2));
  b.add('egr_valve', at(box(0.08, 0.08, 0.08, 0x78716c, 0.02), ex - 0.3, ey + 0.3, -0.18));
  b.add('coolant_reservoir', at(box(0.12, 0.12, 0.14, 0xe0f2fe, 0.03), ex + 0.2, ey + 0.3, W - 0.3));
  b.add('alternator', at(tf(cyl(0.07, 0.07, 0.12, 0xa1a1aa), { rotation: [Math.PI / 2, 0, 0] }), ex + 0.22, ey - 0.05, -spec.cylinders * 0.055 - 0.12));
  b.add('accessory_belt', at(tf(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.01, 6, 36), mat(0x18181b)), { scale: [1.3, 1, 1] }), ex + 0.12, ey - 0.02, -spec.cylinders * 0.055 - 0.2));
  b.add('turbo', at(new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.04, 12, 24), mat(0xb45309)), ex + 0.3, ey - 0.05, 0.12));
  b.add('intercooler', at(box(0.06, 0.18, W * 1.2, 0x475569, 0.02), L - 0.12, 0.38, 0));

  const yUnder = 0.24;
  b.add('exhaust', tube([[ex + 0.25, ey - 0.05, 0], [ex + 0.32, 0.4, -0.05], [ex + 0.1, yUnder, -0.1], [axleF - 0.6, yUnder, -0.12]], 0.035, PALETTE.exhaust));
  b.add('o2_sensor_upstream', at(cyl(0.015, 0.015, 0.08, 0xf472b6), ex + 0.3, 0.45, -0.05));
  b.add('catalytic_converter', at(tf(cyl(0.09, 0.09, 0.36, 0xa8a29e, 24), { rotation: [0, 0, Math.PI / 2] }), axleF - 0.8, yUnder, -0.12));
  b.add('o2_sensor_downstream', at(cyl(0.015, 0.015, 0.08, 0xf472b6), axleF - 1.03, yUnder + 0.08, -0.12));
  const dpfX = axleF - 1.35;
  if (spec.fuel === 'diesel') {
    b.add('dpf', at(tf(cyl(0.1, 0.1, 0.4, 0x57534e, 24), { rotation: [0, 0, Math.PI / 2] }), dpfX, yUnder, -0.12));
    b.add('dpf_pressure_sensor', at(box(0.05, 0.04, 0.04, 0x10b981, 0.01), dpfX, yUnder + 0.16, -0.25));
    b.add('dpf_pressure_sensor', tube([[dpfX - 0.18, yUnder + 0.08, -0.12], [dpfX, yUnder + 0.16, -0.25], [dpfX + 0.18, yUnder + 0.08, -0.12]], 0.008, 0x111827));
    b.add('adblue_tank', at(box(0.22, 0.2, 0.2, 0x38bdf8, 0.04), axleR + 0.15, 0.4, -W + 0.3));
  }
  b.add('exhaust', tube([[axleF - 0.98, yUnder, -0.12], [dpfX - 0.3, yUnder, -0.12], [axleR + 0.1, yUnder + 0.05, -0.3], [-L + 0.35, yUnder + 0.05, -0.35]], 0.03, PALETTE.exhaust));
  b.add('exhaust', at(tf(cyl(0.12, 0.12, 0.4, 0x57534e, 24), { rotation: [0, 0, Math.PI / 2], scale: [1, 1, 0.7] }), -L + 0.25, yUnder + 0.05, -0.35));

  b.add('fuel_tank', at(box(0.6, 0.22, W * 1.3, 0x1e3a8a, 0.06), axleR + 0.75, 0.33, 0.08));
  b.add('fuel_pump', at(cyl(0.06, 0.06, 0.06, 0xfacc15), axleR + 0.75, 0.47, 0.25));
  b.add('fuel_filter', at(tf(cyl(0.04, 0.04, 0.14, 0xfde047), { rotation: [0, 0, Math.PI / 2] }), 0.0, 0.26, W - 0.35));
  b.add('fuel_rail', tube([[axleR + 0.75, 0.42, 0.3], [0.0, 0.26, W - 0.35], [ex - 0.3, 0.5, 0.2]], 0.008, 0x65a30d));
  b.add('evap_canister', at(cyl(0.07, 0.07, 0.2, 0x166534), axleR + 0.2, 0.45, W - 0.25));
  b.add('fuel_cap', at(tf(cyl(0.06, 0.06, 0.02, 0x9ca3af), { rotation: [Math.PI / 2, 0, 0] }), axleR + 0.15, 0.95, -W + 0.02));

  if (spec.fuel === 'hybrid') {
    // Small traction battery under the rear seat + motor-generator in the gearbox + inverter.
    b.add('hv_battery', at(box(0.5, 0.18, W * 1.2, 0x374151, 0.03), axleR + 0.25, 0.55, 0));
    b.add('inverter', at(box(0.26, 0.1, 0.3, 0x475569, 0.03), ex - 0.1, ey + 0.38, W - 0.45));
    b.add('drive_motor', at(tf(cyl(0.12, 0.12, 0.14, 0x9ca3af, 24), { rotation: [Math.PI / 2, 0, 0] }), ex - 0.05, 0.6, Math.max(spec.cylinders * 0.055, 0.2) + 0.52));
    b.add('hv_cables', tube([[axleR + 0.25, 0.55, -0.3], [0, 0.3, -0.4], [ex - 0.1, ey + 0.38, W - 0.45]], 0.016, 0xf97316));
  }
  return b.root;
}

function motorcycle(spec: VehicleSpec): THREE.Group {
  const b = builder();
  const wr = 0.32;
  const front = 0.75;
  const rear = -0.72;
  b.add('wheel_fl', at(wheel(wr, 0.12), front, wr, 0));
  b.add('wheel_rr', at(wheel(wr, 0.16), rear, wr, 0));
  b.add('brake_fl', at(brakeDisc(wr), front, wr, 0.09));
  b.root.add(at(brakeDisc(wr * 0.8), rear, wr, -0.1));
  b.add('wheel_speed_sensor_fl', at(box(0.03, 0.04, 0.03, 0x10b981, 0.01), front - 0.08, wr + 0.1, 0.1));
  b.add('wheel_speed_sensor_rr', at(box(0.03, 0.04, 0.03, 0x10b981, 0.01), rear + 0.08, wr + 0.1, -0.1));
  // Frame and fork
  b.root.add(tube([[front - 0.1, 0.95, 0], [0.25, 0.85, 0], [-0.25, 0.75, 0], [rear, wr, 0]], 0.03, 0x9ca3af));
  b.root.add(tube([[front, wr, 0.06], [front - 0.18, 1.0, 0.06]], 0.025, 0xd4d4d8));
  b.root.add(tube([[front, wr, -0.06], [front - 0.18, 1.0, -0.06]], 0.025, 0xd4d4d8));
  b.root.add(tube([[front - 0.22, 1.08, -0.35], [front - 0.18, 1.04, 0], [front - 0.22, 1.08, 0.35]], 0.015, 0x111827));
  b.add('fuel_tank', at(box(0.48, 0.2, 0.3, 0x1d4ed8, 0.1), 0.18, 0.95, 0));
  b.add('fuel_cap', at(cyl(0.04, 0.04, 0.02, 0x9ca3af), 0.25, 1.06, 0));
  b.root.add(at(box(0.55, 0.08, 0.26, 0x111827, 0.04), -0.35, 0.92, 0)); // seat
  if (spec.fuel === 'electric') {
    b.add('hv_battery', at(box(0.42, 0.32, 0.26, 0x374151, 0.04), 0.05, 0.55, 0));
    b.add('drive_motor', at(tf(cyl(0.1, 0.1, 0.16, 0x9ca3af, 24), { rotation: [Math.PI / 2, 0, 0] }), -0.22, 0.42, 0));
    b.add('inverter', at(box(0.14, 0.08, 0.16, 0x475569, 0.02), -0.12, 0.66, 0));
    b.add('onboard_charger', at(box(0.14, 0.08, 0.14, 0x334155, 0.02), 0.2, 0.83, 0));
    b.add('hv_cables', tube([[0.05, 0.7, 0.12], [-0.08, 0.66, 0.12], [-0.22, 0.48, 0.1]], 0.012, 0xf97316));
    b.add('charge_port', at(cyl(0.035, 0.035, 0.02, 0x111827), 0.25, 1.06, 0));
    b.add('sprocket_front', at(tf(cyl(0.05, 0.05, 0.015, 0xa1a1aa, 16), { rotation: [Math.PI / 2, 0, 0] }), -0.2, 0.42, 0.13));
    b.add('sprocket_rear', at(tf(cyl(0.13, 0.13, 0.015, 0xa1a1aa, 32), { rotation: [Math.PI / 2, 0, 0] }), rear, wr, 0.13));
    const chainShape = new THREE.Shape();
    chainShape.absarc(-0.2, 0.42, 0.055, Math.PI / 2, -Math.PI / 2, false);
    chainShape.absarc(rear, wr, 0.135, -Math.PI / 2, Math.PI / 2, false);
    const pts = chainShape.getPoints(60).map((p) => new THREE.Vector3(p.x, p.y, 0.13));
    b.add('chain', tube(pts.filter((_, i) => i % 3 === 0).map((v) => [v.x, v.y, v.z] as [number, number, number]), 0.01, 0x111827));
    b.add('battery', at(box(0.1, 0.08, 0.08, 0x111827, 0.02), -0.3, 0.75, 0));
    b.add('ecu', at(box(0.1, 0.03, 0.08, 0x0f766e, 0.01), -0.45, 0.78, 0));
    addHeadlights(b, front + 0.02, 1.0, [0]);
    return b.root;
  }
  // Engine (cylinders along X, tilted)
  const n = Math.max(1, spec.cylinders);
  b.add('engine', at(box(0.36, 0.3, 0.26, PALETTE.dark, 0.04), 0.05, 0.5, 0));
  for (let i = 1; i <= n; i++) {
    const z = -((n - 1) * 0.1) / 2 + (i - 1) * 0.1;
    b.add(`cylinder_${i}`, at(cyl(0.05, 0.05, 0.22, 0x94a3b8), 0.12, 0.72, z));
    b.add(`spark_plug_${i}`, at(cyl(0.01, 0.01, 0.08, 0xe5e7eb), 0.12, 0.86, z));
    b.add(`coil_${i}`, at(box(0.04, 0.06, 0.04, 0x111827, 0.01), 0.12, 0.9, z));
    b.add(`injector_${i}`, at(cyl(0.01, 0.01, 0.07, 0x84cc16), 0.0, 0.8, z));
  }
  b.add('oil_filter', at(cyl(0.04, 0.04, 0.08, 0x2563eb), 0.2, 0.38, 0.12));
  b.add('oil_drain_plug', at(cyl(0.02, 0.02, 0.03, 0xd4d4d8), 0.05, 0.33, 0));
  b.add('oil_filler_cap', at(cyl(0.025, 0.025, 0.03, PALETTE.yellow), -0.08, 0.62, 0.14));
  b.add('dipstick', at(box(0.04, 0.04, 0.01, 0xfde68a, 0.005), -0.05, 0.42, 0.14));
  b.add('transmission', at(box(0.2, 0.18, 0.22, 0x52525b, 0.03), -0.18, 0.45, 0));
  b.add('sprocket_front', at(tf(cyl(0.05, 0.05, 0.015, 0xa1a1aa, 16), { rotation: [Math.PI / 2, 0, 0] }), -0.2, 0.42, 0.13));
  b.add('sprocket_rear', at(tf(cyl(0.13, 0.13, 0.015, 0xa1a1aa, 32), { rotation: [Math.PI / 2, 0, 0] }), rear, wr, 0.13));
  const chainShape = new THREE.Shape();
  chainShape.absarc(-0.2, 0.42, 0.055, Math.PI / 2, -Math.PI / 2, false);
  chainShape.absarc(rear, wr, 0.135, -Math.PI / 2, Math.PI / 2, false);
  const chainPts = chainShape.getPoints(60).map((p) => new THREE.Vector3(p.x, p.y, 0.13));
  b.add('chain', new THREE.Line(new THREE.BufferGeometry().setFromPoints([...chainPts, chainPts[0]]), new THREE.LineBasicMaterial({ color: 0xe5e7eb })));
  b.add('chain', tube(chainPts.filter((_, i) => i % 3 === 0).map((v) => [v.x, v.y, v.z] as [number, number, number]), 0.008, 0xd4d4d8));
  b.add('radiator', at(box(0.04, 0.25, 0.3, 0x64748b, 0.02), 0.42, 0.62, 0));
  b.add('coolant_reservoir', at(box(0.06, 0.08, 0.06, 0xe0f2fe, 0.02), 0.35, 0.45, -0.14));
  b.add('battery', at(box(0.14, 0.1, 0.1, 0x111827, 0.02), -0.3, 0.75, 0));
  b.add('ecu', at(box(0.1, 0.03, 0.08, 0x0f766e, 0.01), -0.45, 0.78, 0));
  b.add('air_filter', at(box(0.16, 0.08, 0.2, 0x1f2937, 0.03), 0.0, 0.88, 0));
  b.add('throttle_body', at(cyl(0.03, 0.03, 0.05, 0x9ca3af), -0.04, 0.8, 0.0));
  b.add('exhaust', tube([[0.2, 0.62, 0], [0.32, 0.3, 0.05], [0.0, 0.22, 0.14], [-0.4, 0.4, 0.2], [-0.7, 0.55, 0.2]], 0.03, PALETTE.exhaust));
  b.add('catalytic_converter', at(tf(cyl(0.06, 0.06, 0.18, 0xa8a29e), { rotation: [0, 0, Math.PI / 2] }), -0.15, 0.27, 0.16));
  b.add('o2_sensor_upstream', at(cyl(0.012, 0.012, 0.06, 0xf472b6), 0.25, 0.36, 0.06));
  addHeadlights(b, front + 0.02, 1.0, [0]);
  return b.root;
}

function truck(spec: VehicleSpec): THREE.Group {
  const b = builder();
  const wr = 0.52;
  const cab: [number, number][] = [[1.0, 0.75], [3.0, 0.75], [3.1, 1.2], [3.05, 3.4], [1.0, 3.5]];
  b.root.add(shell(cab, 2.3));
  b.root.add(shell([[-5.5, 1.2], [0.85, 1.2], [0.85, 3.9], [-5.5, 3.9]], 2.4, 0xa78bfa));
  b.root.add(at(box(9.0, 0.2, 1.0, 0x374151, 0.03), -1.3, 0.9, 0)); // chassis
  const axles: [string, number][] = [['f', 2.4], ['r', -1.2], ['r2', -2.6]];
  for (const [s, x] of axles) {
    for (const side of [1, -1]) {
      const id = s === 'f' ? (side > 0 ? 'wheel_fl' : 'wheel_fr') : side > 0 ? 'wheel_rl' : 'wheel_rr';
      b.add(id, at(wheel(wr, 0.32), x, wr, side * 1.05));
      if (s === 'f') b.add(side > 0 ? 'brake_fl' : 'brake_fr', at(brakeDisc(wr), x, wr, side * 0.85));
      const sensor = s === 'f' ? (side > 0 ? 'fl' : 'fr') : side > 0 ? 'rl' : 'rr';
      b.add(`wheel_speed_sensor_${sensor}`, at(box(0.06, 0.08, 0.06, 0x10b981, 0.01), x - 0.2, wr + 0.2, side * 0.8));
    }
  }
  const ex = 2.2;
  engine(b, ex, 1.35, spec.cylinders || 6, 'diesel', 2.2);
  b.add('transmission', at(box(0.8, 0.5, 0.5, 0x52525b, 0.06), ex - 1.3, 1.1, 0));
  b.add('vehicle_speed_sensor', at(cyl(0.03, 0.03, 0.08, 0x10b981), ex - 1.7, 1.0, 0.2));
  b.add('turbo', at(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.08, 12, 24), mat(0xb45309)), ex + 0.6, 1.5, -0.55));
  b.add('intercooler', at(box(0.08, 0.7, 1.6, 0x475569, 0.02), 3.05, 1.4, 0));
  b.add('radiator', at(box(0.08, 0.8, 1.6, 0x64748b, 0.02), 2.95, 1.45, 0));
  b.add('cooling_fan', at(tf(cyl(0.38, 0.38, 0.06, 0x1f2937, 24), { rotation: [0, 0, Math.PI / 2] }), 2.85, 1.45, 0));
  b.add('coolant_reservoir', at(box(0.25, 0.2, 0.3, 0xe0f2fe, 0.04), 2.5, 2.3, 0.7));
  b.add('air_filter', at(tf(cyl(0.2, 0.2, 0.7, 0x1f2937), {}), 1.1, 2.6, -1.2));
  b.add('maf_sensor', at(cyl(0.06, 0.06, 0.15, 0xf97316), 1.5, 2.0, -0.8));
  b.add('intake_manifold', at(box(0.2, 0.18, 1.2, 0x334155, 0.04), ex - 0.55, 1.85, 0));
  b.add('egr_valve', at(box(0.14, 0.14, 0.14, 0x78716c, 0.02), ex - 0.5, 2.0, -0.4));
  b.add('fuel_tank', at(tf(box(1.4, 0.6, 0.6, 0x9ca3af, 0.2), {}), -0.2, 0.75, 1.0));
  b.add('fuel_cap', at(cyl(0.08, 0.08, 0.03, 0x111827), 0.3, 1.07, 1.0));
  b.add('fuel_pump', at(cyl(0.08, 0.08, 0.12, 0xfacc15), ex - 0.5, 1.1, 0.55));
  b.add('fuel_filter', at(cyl(0.07, 0.07, 0.25, 0xfde047), 0.9, 1.2, 0.75));
  b.add('adblue_tank', at(box(0.5, 0.45, 0.45, 0x38bdf8, 0.08), 0.6, 0.75, -1.0));
  b.add('dpf', at(box(0.9, 0.6, 0.6, 0x57534e, 0.1), -0.6, 0.85, -1.0));
  b.add('dpf_pressure_sensor', at(box(0.08, 0.06, 0.06, 0x10b981, 0.01), -0.6, 1.2, -0.75));
  b.add('catalytic_converter', at(box(0.5, 0.5, 0.5, 0xa8a29e, 0.1), -1.3, 0.85, -1.0));
  b.add('o2_sensor_upstream', at(cyl(0.02, 0.02, 0.1, 0xf472b6), -0.05, 1.18, -1.0));
  b.add('o2_sensor_downstream', at(cyl(0.02, 0.02, 0.1, 0xf472b6), -1.6, 1.18, -1.0));
  b.add('exhaust', tube([[ex + 0.6, 1.4, -0.55], [ex, 0.85, -0.7], [-0.1, 0.85, -1.0]], 0.07, PALETTE.exhaust));
  b.add('exhaust', tube([[-1.55, 0.85, -1.0], [-2.0, 0.75, -0.9]], 0.06, PALETTE.exhaust));
  b.add('battery', at(box(0.6, 0.35, 0.5, 0x111827, 0.04), -2.0, 0.8, 1.0));
  b.add('alternator', at(cyl(0.12, 0.12, 0.2, 0xa1a1aa), ex + 0.55, 1.1, 0.6));
  b.add('accessory_belt', at(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.015, 6, 36), mat(0x18181b)), ex + 0.6, 1.3, -0.95));
  b.add('ecu', at(box(0.3, 0.08, 0.25, 0x0f766e, 0.01), ex - 0.4, 1.4, -0.75));
  b.add('abs_module', at(box(0.25, 0.2, 0.2, 0x6b7280, 0.02), 1.3, 1.1, -0.6));
  b.add('cabin', at(box(0.5, 0.35, 2.0, 0x1e293b, 0.05), 2.6, 2.4, 0));
  b.add('cabin_filter', at(box(0.4, 0.05, 0.5, 0xfde68a, 0.01), 2.85, 3.0, 0));
  b.add('brake_fluid_reservoir', at(box(0.12, 0.12, 0.12, 0xfef08a, 0.02), 2.9, 2.1, -0.7));
  b.add('washer_reservoir', at(box(0.2, 0.25, 0.2, 0x60a5fa, 0.03), 2.8, 1.0, 0.85));
  b.add('can_bus', tube([[ex - 0.4, 1.4, -0.75], [2.6, 2.4, -0.5], [1.3, 1.1, -0.6], [-2.0, 1.0, 0.8]], 0.015, 0xf59e0b));
  addHeadlights(b, 3.08, 1.0, [0.9, -0.9]);
  const wiper = box(0.04, 0.03, 0.9, 0x0f172a, 0.01);
  b.add('wiper_blades', at(wiper, 3.1, 2.2, 0.3));
  return b.root;
}

export function buildVehicle(spec: VehicleSpec): THREE.Group {
  const n = Math.min(Math.max(spec.cylinders || 4, 1), 8);
  const s = { ...spec, cylinders: n };
  switch (spec.type) {
    case 'motorcycle':
      return motorcycle(s);
    case 'truck':
      return truck({ ...s, cylinders: spec.cylinders || 6 });
    case 'van':
      return carLike(s, true);
    default:
      return carLike(s, false);
  }
}
