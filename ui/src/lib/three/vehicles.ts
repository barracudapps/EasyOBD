// Procedural vehicle models. Every diagnosable part is a named Object3D (`userData.componentId`)
// whose id matches the knowledge base / maintenance data (e.g. "coil_2", "catalytic_converter").
// No external asset: works offline and weighs nothing.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export interface VehicleSpec {
  type: string; // car | van | motorcycle | truck
  cylinders: number;
  fuel: string; // petrol | diesel | hybrid | electric
  traction?: string; // front | rear | both
  make?: string;
  /** Body style: car styles (hatch, sedan, suv…) or motorcycle styles (naked, adventure, sport…). */
  body?: string;
  /** Engine description (e.g. "1254 cm³ boxer"): drives the motorcycle engine layout. */
  engine?: string;
  /** Motorcycles: chain (default), shaft, belt, cvt, hub. */
  finalDrive?: string;
  /** Cars: front (default), mid (behind the seats) or rear (Porsche 911). */
  enginePosition?: string;
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

/** Wheel with tyre, tread grooves, 5-spoke rim and lug nuts. Spins around its local Z axis. */
function wheel(radius: number, width: number, outward = true) {
  const g = new THREE.Group();
  const rubber = mat(PALETTE.rubber, { metalness: 0, roughness: 0.92 });
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.76, radius * 0.25, 20, 56), rubber);
  tyre.scale.z = width / (radius * 0.5);
  g.add(tyre);
  // Tread grooves: thin dark rings on the contact surface
  const groove = mat(0x050608, { metalness: 0, roughness: 1 });
  for (const k of [-0.22, 0, 0.22]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.003, radius * 0.012, 4, 64), groove);
    r.position.z = k * width;
    g.add(r);
  }
  const rimMat = mat(0xb8c0cc, { metalness: 0.85, roughness: 0.25 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.56, radius * 0.56, width * 0.75, 40, 1, true), rimMat);
  barrel.rotation.x = Math.PI / 2;
  const face = outward ? 1 : -1;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.13, radius * 0.15, 0.04, 24), rimMat);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = face * width * 0.3;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.56, radius * 0.025, 8, 48), rimMat);
  lip.position.z = face * width * 0.36;
  g.add(barrel, hub, lip);
  const nutMat = mat(0x6b7280, { metalness: 0.9, roughness: 0.3 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    // Twin spokes for a modern alloy look
    for (const off of [-0.09, 0.09]) {
      const spoke = new THREE.Mesh(new RoundedBoxGeometry(radius * 0.44, radius * 0.07, 0.03, 2, 0.008), rimMat);
      spoke.position.set(Math.cos(a + off) * radius * 0.34, Math.sin(a + off) * radius * 0.34, face * width * 0.28);
      spoke.rotation.z = a + off;
      g.add(spoke);
    }
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), nutMat);
    nut.rotation.x = Math.PI / 2;
    nut.position.set(Math.cos(a + Math.PI / 5) * radius * 0.085, Math.sin(a + Math.PI / 5) * radius * 0.085, face * width * 0.33);
    g.add(nut);
  }
  g.userData.spin = 'z';
  return g;
}

/** Ventilated disc (spins) + fixed caliper. */
function brakeDisc(radius: number, scale = 1) {
  const g = new THREE.Group();
  const rotor = new THREE.Group();
  const discMat = mat(0xb4b9c2, { metalness: 0.9, roughness: 0.35 });
  for (const off of [-0.011, 0.011]) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5 * scale, radius * 0.5 * scale, 0.01, 40), discMat);
    d.position.y = off;
    rotor.add(d);
  }
  const vane = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.48 * scale, radius * 0.48 * scale, 0.012, 40), mat(0x3f3f46));
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.2, radius * 0.2, 0.05, 24), mat(0x6b7280));
  rotor.add(vane, hat);
  rotor.rotation.x = Math.PI / 2;
  rotor.userData.spin = 'y';
  const caliper = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.17 * scale, 0.09, 3, 0.025), mat(0xc81e1e, { metalness: 0.3, roughness: 0.45 }));
  caliper.position.set(radius * 0.32, radius * 0.27, 0);
  g.add(rotor, caliper);
  return g;
}

/** Radiator fan with blades, axis along local Z (spins). */
function fan(radius: number) {
  const g = new THREE.Group();
  const m = mat(0x1f2937, { roughness: 0.6 });
  g.add(tf(new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, 0.05, 20), m), { rotation: [Math.PI / 2, 0, 0] }));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const blade = new THREE.Mesh(new RoundedBoxGeometry(radius * 0.75, radius * 0.28, 0.01, 1, 0.004), m);
    blade.position.set(Math.cos(a) * radius * 0.55, Math.sin(a) * radius * 0.55, 0);
    blade.rotation.set(0.35, 0, a);
    g.add(blade);
  }
  const spinner = new THREE.Group();
  spinner.add(g);
  g.userData.spin = 'z';
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.02, 0.012, 6, 40), m);
  spinner.add(ring);
  return spinner;
}

// ---------------------------------------------------------------- body panels (painted + X-ray twin)

type PanelKind = 'paint' | 'glass' | 'dark' | 'light' | 'lamp' | 'trim' | 'plate' | 'alu';
type Panel = { geo: THREE.BufferGeometry; kind?: PanelKind; ghost?: boolean };

/** Bakes a transform into a geometry (shared by the painted mesh and its ghost twin). */
function place(geo: THREE.BufferGeometry, x: number, y: number, z: number, r: [number, number, number] = [0, 0, 0], s?: [number, number, number]) {
  if (s) geo.scale(s[0], s[1], s[2]);
  if (r[0]) geo.rotateX(r[0]);
  if (r[1]) geo.rotateY(r[1]);
  if (r[2]) geo.rotateZ(r[2]);
  geo.translate(x, y, z);
  return geo;
}
/**
 * Sculpts a body panel: scales Z (vehicle width) by `s(x, y)` — plan-view rounding of the nose and
 * tail, door-panel bulge, tumblehome of the glasshouse. Normals are transformed exactly
 * (inverse-transpose of the deformation Jacobian), so smooth shading survives.
 */
function sculpt(geo: THREE.BufferGeometry, s: (x: number, y: number) => number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const h = 1e-3;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = s(x, y);
    pos.setZ(i, z * k);
    if (nor) {
      const kx = (s(x + h, y) - s(x - h, y)) / (2 * h);
      const ky = (s(x, y + h) - s(x, y - h)) / (2 * h);
      n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
      n.set(n.x - ((z * kx) / k) * n.z, n.y - ((z * ky) / k) * n.z, n.z / k).normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

const rbox = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.01, h / 2.01, d / 2.01));

/** Painted body shown when idle, translucent glowing twin in X-ray mode / when parts are highlighted. */
function bodyShell(panels: Panel[], paint: number) {
  const mats: Record<PanelKind, THREE.Material> = {
    // Metallic paint under a glossy clear coat: sharp studio reflections over a softer base.
    paint: new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.62, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.25 }),
    // Tinted glass: mostly reflective at grazing angles, the cabin stays readable.
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a1018, metalness: 0.55, roughness: 0.03, transparent: true, opacity: 0.84, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 }),
    // Textured black plastic (bumper inserts, sills, arch liners, window seals).
    dark: new THREE.MeshPhysicalMaterial({ color: 0x0b0e14, roughness: 0.72, metalness: 0, sheen: 0.3, sheenRoughness: 0.8 }),
    light: new THREE.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0xdc2626, emissiveIntensity: 0.7 }),
    lamp: new THREE.MeshPhysicalMaterial({ color: 0xe0f2fe, emissive: 0xf8fafc, emissiveIntensity: 0.35, metalness: 0.2, roughness: 0.1, clearcoat: 1 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.9, roughness: 0.2 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5 }),
    alu: new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.7, roughness: 0.4 }),
  };
  const solid = new THREE.Group();
  solid.userData.solidShell = true;
  const ghost = new THREE.Group();
  ghost.userData.isShell = true;
  const ghostFill = new THREE.MeshPhysicalMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.06, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const ghostEdge = new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.4 });
  for (const p of panels) {
    solid.add(new THREE.Mesh(p.geo, mats[p.kind ?? 'paint']));
    if (p.ghost) ghost.add(new THREE.Mesh(p.geo, ghostFill), new THREE.LineSegments(new THREE.EdgesGeometry(p.geo, 28), ghostEdge));
  }
  const g = new THREE.Group();
  g.add(solid, ghost);
  g.traverse((x) => (x.userData.shell = true));
  return g;
}

const PAINT_BY_MAKE: Record<string, number> = {
  Tesla: 0xe8ecf1, Renault: 0x2a4f8f, Peugeot: 0x3a3f47, Dacia: 0x6b7a5a, Kia: 0x1d5c63, Toyota: 0xb7c3cf, BMW: 0x1f3b73,
  Volkswagen: 0x7a8796, Alpine: 0x1e5aa8, Porsche: 0xb9bec5, Volvo: 0x4b5563, Polestar: 0xd1d5db, Saab: 0x5f6b52, Hongqi: 0x141414,
  Zeekr: 0x2d3436, Audi: 0x6b7280, Ferrari: 0xb91c1c, KTM: 0xf97316, Ducati: 0xc8102e, Kawasaki: 0x3f9b2e, Triumph: 0x1c2833,
  Yamaha: 0x1e40af, Honda: 0xb91c1c, Husqvarna: 0xe5e7eb, Aprilia: 0x111827, 'Harley-Davidson': 0x111827, Indian: 0x7f1d1d,
  Lamborghini: 0xe0a106, Lotus: 0x0f5a3a, McLaren: 0xf26b0f, 'Aston Martin': 0x0f4d3c, Maserati: 0x1b2a4a, Bentley: 0x2d3036,
  Jaguar: 0x17324f, Chevrolet: 0xb3121a, Nissan: 0x8b9199,
  'John Deere': 0x367c2b, Fendt: 0x3f7d3a, Claas: 0xa8b820, 'New Holland': 0x1e4b9b, 'Case IH': 0xb5121b, 'Massey Ferguson': 0xc8102e,
  'Deutz-Fahr': 0x6fae1d, Kubota: 0xf26f21, Valtra: 0xb01f24, Same: 0xc81e1e,
  'Moto Guzzi': 0x7f1d1d, Suzuki: 0x1d4ed8, 'Royal Enfield': 0x4b5320, Piaggio: 0x7dd3c0, Scania: 0xe5e7eb,
  DAF: 0xf3f4f6, MAN: 0xe5e7eb, Iveco: 0x1e3a8a, 'Renault Trucks': 0xd1d5db, 'Mercedes-Benz': 0x9ca3af,
};

/** Paint colour derived from the make (stable, tasteful palette). */
function paintFor(make: string): number {
  const palette = [0x1f3b73, 0x7a8796, 0xd9dde3, 0x3a3f47, 0x8c1c24, 0x1d5c63, 0x4b5f3a, 0x2c2c34, 0xb7c3cf];
  if (PAINT_BY_MAKE[make] !== undefined) return PAINT_BY_MAKE[make];
  let h = 0;
  for (const c of make) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

// ---------------------------------------------------------------- car body styles

export type CarStyle = 'hatch' | 'sedan' | 'estate' | 'suv' | 'mpv' | 'coupe' | 'supercar' | 'pickup' | 'micro' | 'van';
/** Dimensions in metres-ish (half length L, half width W). rTop / rBase are offsets from the tail (-L). */
interface Style { wedge?: number; intakes?: boolean; L: number; W: number; wr: number; low: number; belt: number; roof: number; hood: number; ws: number; rTop: number; rBase: number; aF: number; aR: number; doors: 2 | 3 | 4; rails?: boolean; bed?: boolean }
export const CAR_STYLES: Record<CarStyle, Style> = {
  hatch: { L: 2.05, W: 0.85, wr: 0.33, low: 0.3, belt: 1.02, roof: 1.48, hood: 0.85, ws: 0.72, rTop: 0.62, rBase: 0.14, aF: 0.72, aR: 0.68, doors: 4 },
  sedan: { L: 2.38, W: 0.88, wr: 0.34, low: 0.3, belt: 1.0, roof: 1.45, hood: 0.92, ws: 0.8, rTop: 1.2, rBase: 0.62, aF: 0.78, aR: 0.8, doors: 4 },
  estate: { L: 2.38, W: 0.88, wr: 0.34, low: 0.3, belt: 1.02, roof: 1.5, hood: 0.92, ws: 0.76, rTop: 0.3, rBase: 0.12, aF: 0.78, aR: 0.8, doors: 4, rails: true },
  suv: { L: 2.28, W: 0.93, wr: 0.38, low: 0.4, belt: 1.2, roof: 1.74, hood: 0.92, ws: 0.7, rTop: 0.4, rBase: 0.14, aF: 0.78, aR: 0.74, doors: 4, rails: true },
  mpv: { L: 2.22, W: 0.89, wr: 0.34, low: 0.32, belt: 1.08, roof: 1.76, hood: 0.72, ws: 0.95, rTop: 0.3, rBase: 0.1, aF: 0.74, aR: 0.7, doors: 4 },
  coupe: { L: 2.22, W: 0.91, wr: 0.34, low: 0.26, belt: 0.92, roof: 1.27, hood: 1.05, ws: 0.82, rTop: 0.95, rBase: 0.3, aF: 0.78, aR: 0.72, doors: 2 },
  // Mid-engine sports car: short nose, cab-forward glasshouse, long engine deck.
  supercar: { L: 2.26, W: 0.98, wr: 0.35, low: 0.2, belt: 0.8, roof: 1.13, hood: 0.92, ws: 0.95, rTop: 1.32, rBase: 0.5, aF: 0.8, aR: 0.74, doors: 2, wedge: 0.16, intakes: true },
  pickup: { L: 2.65, W: 0.93, wr: 0.39, low: 0.44, belt: 1.24, roof: 1.9, hood: 0.95, ws: 0.6, rTop: 2.42, rBase: 2.32, aF: 0.82, aR: 0.92, doors: 4, bed: true },
  micro: { L: 1.3, W: 0.66, wr: 0.27, low: 0.28, belt: 0.95, roof: 1.55, hood: 0.4, ws: 0.45, rTop: 0.28, rBase: 0.1, aF: 0.5, aR: 0.5, doors: 2 },
  van: { L: 2.55, W: 0.95, wr: 0.36, low: 0.32, belt: 1.22, roof: 2.02, hood: 0.6, ws: 0.35, rTop: 0.12, rBase: 0.06, aF: 0.75, aR: 0.85, doors: 3 },
};

/** Painted body (style-dependent silhouette, doors, glass, lights, plates) + X-ray twin. */
function carBody(st: Style, axleF: number, axleR: number, paint: number) {
  const { L, W, wr, low, belt, roof } = st;
  const hoodEnd = L - st.hood;
  const wTop = hoodEnd - st.ws;
  const rTop = -L + st.rTop;
  const rBase = -L + st.rBase;
  const r = wr + 0.08;

  const lower = new THREE.Shape();
  lower.moveTo(-L + 0.1, low);
  lower.lineTo(axleR - r, low);
  lower.absarc(axleR, wr, r, Math.PI, 0, true);
  lower.lineTo(axleF - r, low);
  lower.absarc(axleF, wr, r, Math.PI, 0, true);
  lower.lineTo(L - 0.14, low);
  lower.quadraticCurveTo(L + 0.03, low, L, low + 0.22);
  const wd = st.wedge ?? 0; // how much lower the nose is than the scuttle
  lower.quadraticCurveTo(L - 0.02, belt - 0.1 - wd, L - 0.32, belt - 0.03 - wd * 0.85);
  lower.lineTo(hoodEnd, belt);
  lower.lineTo(-L + 0.22, belt + 0.03);
  lower.quadraticCurveTo(-L + 0.02, belt, -L, belt - 0.22);
  lower.lineTo(-L, low + 0.12);
  lower.quadraticCurveTo(-L, low, -L + 0.1, low);

  const glass = new THREE.Shape();
  glass.moveTo(hoodEnd, belt - 0.01);
  glass.quadraticCurveTo(hoodEnd - 0.1, belt + 0.1, wTop, roof - 0.04);
  glass.quadraticCurveTo(wTop - 0.08, roof, wTop - 0.25, roof);
  glass.lineTo(rTop + 0.15, roof);
  glass.quadraticCurveTo(rTop, roof - 0.02, rTop - 0.05, roof - 0.12);
  glass.lineTo(rBase, belt + 0.03);
  glass.lineTo(hoodEnd, belt - 0.01);

  const ext = (s: THREE.Shape, depth: number, bevel: number) => {
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 5, curveSegments: 24 });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  const panels: Panel[] = [
    { geo: ext(lower, W * 2 - 0.16, 0.08), ghost: true },
    { geo: ext(glass, W * 2 - 0.36, 0.08), kind: 'glass', ghost: true },
  ];
  const add = (geo: THREE.BufferGeometry, kind: PanelKind = 'paint') => panels.push({ geo, kind });
  // Roof panel and pillars
  const roofLen = Math.abs(wTop - 0.25 - (rTop + 0.15)) + 0.1;
  // Painted roof skin wrapping the top of the glasshouse (no floating slab).
  const roofSkin = place(rbox(roofLen, 0.12, W * 2 - 0.3, 0.055), (wTop - 0.25 + rTop + 0.15) / 2, roof + 0.03, 0);
  {
    // Crowned roof: higher on the centre line, like a pressed steel panel.
    const p = roofSkin.attributes.position as THREE.BufferAttribute;
    const hw = W - 0.15;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > roof + 0.03) p.setY(i, p.getY(i) + 0.035 * (1 - (p.getZ(i) / hw) ** 2));
    roofSkin.computeVertexNormals();
  }
  add(roofSkin);
  if (st.doors === 4) add(place(rbox(0.07, roof - belt, W * 2 - 0.18, 0.01), (wTop + rTop) / 2 - 0.05, (roof + belt) / 2 + 0.02, 0), 'dark');
  if (st.rails) for (const z of [W - 0.2, -W + 0.2]) add(place(rbox(roofLen * 0.85, 0.03, 0.04, 0.012), (wTop - 0.25 + rTop + 0.15) / 2, roof + 0.13, z), 'trim');
  // Door seams and handles
  const seams = [axleF - r - 0.04];
  if (st.doors === 4) seams.push((wTop + rTop) / 2 - 0.05, axleR + r + 0.04);
  else if (st.doors === 2) seams.push(Math.max(rTop + 0.15, axleR + r + 0.05));
  else seams.push((wTop + rTop) / 2 + 0.1, (wTop + rTop) / 2 - 0.8);
  // Seams stop below the shoulder (where the bevel rolls inward) so they never stick out.
  for (const x of seams) add(place(rbox(0.008, belt - low - 0.24, W * 2 + 0.004, 0.003), x, (belt + low) / 2 - 0.02, 0), 'dark');
  for (let i = 1; i < seams.length; i++) {
    for (const z of [W + 0.008, -W - 0.008]) add(place(rbox(0.11, 0.025, 0.02, 0.008), seams[i] + 0.1, belt - 0.1, z), 'trim');
  }
  // Lights, grille, plates, mirrors
  for (const z of [W - 0.28, -W + 0.28]) {
    add(place(rbox(0.05, 0.08, 0.32), -L - 0.07, belt - 0.14, z), 'light');
    // Headlight lens wrapping the front corner + daytime running light strip
    add(place(rbox(0.16, 0.075, 0.36, 0.03), L + 0.05, low + (belt - wd - low) * 0.6, Math.sign(z) * (W - 0.22), [0, 0, -0.6]), 'lamp');
  }
  // The extrusion bevel pushes the nose and tail 0.08 outward: front / rear details sit on that skin.
  add(place(rbox(0.05, 0.13, W * 1.05, 0.03), L + 0.085, low + 0.25, 0), 'dark');
  add(place(rbox(0.05, 0.08, W * 1.4, 0.03), L + 0.07, low + 0.06, 0), 'dark');
  add(place(rbox(0.012, 0.11, 0.5, 0.005), L + 0.105, low + 0.12, 0), 'plate');
  add(place(rbox(0.012, 0.11, 0.5, 0.005), -L - 0.1, belt - 0.34, 0), 'plate');
  for (const side of [1, -1]) {
    add(place(rbox(0.13, 0.08, 0.14, 0.03), hoodEnd - 0.1, belt + 0.1, side * (W + 0.03)));
    add(place(rbox(0.03, 0.05, 0.1, 0.01), hoodEnd - 0.04, belt + 0.1, side * (W + 0.05)), 'glass');
  }
  // Pick-up: open load bed (dark liner) and tailgate seam
  if (st.bed) {
    const bedFront = rBase - 0.1;
    const bedLen = bedFront - (-L + 0.12);
    add(place(rbox(bedLen, 0.02, W * 2 - 0.32, 0.005), bedFront - bedLen / 2, belt + 0.09, 0), 'dark');
    add(place(rbox(0.012, belt - low - 0.2, W * 2 + 0.006, 0.004), -L + 0.06, (belt + low) / 2 + 0.04, 0), 'dark');
  }
  // Window seal along the belt line, side sills between the arches, black arch liners.
  const sealFrom = st.bed ? rBase : rBase + 0.02;
  add(place(rbox(hoodEnd - sealFrom, 0.022, W * 2 - 0.13, 0.008), (hoodEnd + sealFrom) / 2, belt + 0.004, 0), 'dark');
  const sill = axleF - axleR - 2 * r - 0.06;
  add(place(rbox(sill, 0.07, W * 2 + 0.012, 0.025), (axleF + axleR) / 2, low + 0.035, 0), 'dark');
  for (const ax of [axleF, axleR]) {
    for (const side of [1, -1]) {
      const liner = new THREE.TorusGeometry(r - 0.015, 0.035, 8, 28, Math.PI);
      add(place(liner, ax, wr, side * (W - 0.1), [0, 0, 0], [1, 1, 2.2]), 'dark');
    }
  }
  // Mid-engine cars: side air intakes ahead of the rear wheels feeding the radiators / engine
  if (st.intakes) {
    for (const side of [1, -1]) add(place(rbox(0.5, 0.2, 0.06, 0.05), axleR + r + 0.3, (low + belt) / 2 + 0.02, side * (W - 0.01), [0, side * 0.12, 0]), 'dark');
    add(place(rbox(0.12, 0.03, W * 1.7, 0.012), -L + 0.12, belt + 0.06, 0)); // ducktail spoiler
  }
  // Rear diffuser / lower valance
  add(place(rbox(0.06, 0.08, W * 1.5, 0.02), -L - 0.05, low + 0.06, 0), 'dark');

  // Sculpt: rounded nose and tail in plan view, door bulge with tucked sills, glasshouse tumblehome.
  const front = Math.min(0.62, st.hood * 0.75);
  const rear = 0.45;
  const mid = (low + belt) / 2;
  const half = (belt - low) / 2;
  const shape = (x: number, y: number) => {
    const tf = Math.min(1, Math.max(0, (x - (L - front)) / front));
    const tr = Math.min(1, Math.max(0, (-x - (L - rear)) / rear));
    const plan = 1 - 0.17 * tf * tf - 0.11 * tr * tr;
    const v = y <= belt ? 1 - 0.05 * Math.min(1, ((y - mid) / half) ** 2) : 0.95 * (1 - 0.2 * Math.min(1, (y - belt) / (roof - belt)));
    return plan * v;
  };
  for (const p of panels) sculpt(p.geo, shape);
  return bodyShell(panels, paint);
}

// ---------------------------------------------------------------- detailed engine

export interface EngineOpts {
  /** Turbocharger on the exhaust side (diesel and most modern petrol engines). */
  turbo?: boolean;
  /** Accessory drive: crank damper, alternator, A/C compressor, water pump, tensioner, ribbed belt. */
  accessories?: boolean;
  /** Intake plenum, runners and throttle body. */
  intake?: boolean;
  /** First cylinder number minus one (second bank of a V engine). */
  cylOffset?: number;
  /** false for the second bank of a V / boxer engine: no crankshaft, sump, oil filter, accessory drive… */
  primary?: boolean;
  /** Oil sump under the block (V engines draw a single central sump instead). */
  sump?: boolean;
}
export interface EngineResult {
  len: number;
  /** Where the downpipe starts (turbine outlet or exhaust manifold collector). */
  exhaustOut: [number, number, number];
}

const ALU = 0xa7adb6;
const IRON = 0x4a4e57;
const BLACK = 0x16191f;
const SENSOR = 0x10b981;

/** Pulley (axis along Z) that turns while its component is highlighted. */
function pulley(r: number, w: number, color = 0x3f444d, ribs = true) {
  const g = new THREE.Group();
  const p = new THREE.Group();
  p.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 32), mat(color, { metalness: 0.7, roughness: 0.4 })));
  if (ribs) for (const k of [-0.3, 0, 0.3]) p.add(at(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, w * 0.12, 32), mat(0x26292f)), 0, k * w, 0));
  p.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.3, w * 1.3, 16), mat(0x9ca3af, { metalness: 0.9, roughness: 0.3 })));
  p.rotation.x = Math.PI / 2;
  p.userData.spin = 'y';
  g.add(p);
  return g;
}

/** Closed ribbed belt hugging a set of pulleys (convex hull of the pulley circles), in the XY plane at depth z. */
function beltAround(circles: [number, number, number][], z: number, thick: number) {
  const pts: [number, number][] = [];
  for (const [cx, cy, r] of circles) for (let i = 0; i < 48; i++) pts.push([cx + Math.cos((i / 48) * Math.PI * 2) * (r + thick), cy + Math.sin((i / 48) * Math.PI * 2) * (r + thick)]);
  // Monotone-chain convex hull
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  const curve = new THREE.CatmullRomCurve3(hull.map(([x, y]) => new THREE.Vector3(x, y, z)), true, 'centripetal');
  const geo = new THREE.TubeGeometry(curve, 240, thick, 6, true);
  geo.scale(1, 1, 1);
  const m = new THREE.Mesh(geo, mat(0x111214, { metalness: 0, roughness: 0.85 }));
  m.scale.z = 1;
  return m;
}

/** Firing-order phases (radians) so pistons move like a real crankshaft. */
function pistonPhase(i: number, n: number) {
  if (n === 4) return [0, Math.PI, Math.PI, 0][i - 1];
  if (n === 3) return ((i - 1) * 2 * Math.PI) / 3;
  if (n === 6) return [0, (4 * Math.PI) / 3, (2 * Math.PI) / 3, (2 * Math.PI) / 3, (4 * Math.PI) / 3, 0][i - 1];
  if (n === 2) return (i - 1) * Math.PI;
  return ((i - 1) * 2 * Math.PI) / n;
}

/**
 * Detailed inline engine, crankshaft along Z, centred at (x, y, 0) — intake on the -X side, exhaust
 * on +X, timing and accessory drive at -Z, flywheel at +Z. Every serviceable part is its own
 * component: pistons (cylinder_n), spark plugs and pencil coils, direct injectors on a common rail,
 * cam sensor reading its target wheel, timing chain, turbo, alternator, ribbed belt…
 */
function engine(b: Builder, x: number, y: number, n: number, fuel: string, s = 1, o: EngineOpts = {}): EngineResult {
  const { turbo = true, intake = true, cylOffset = 0, primary = true } = o;
  const accessories = (o.accessories ?? true) && primary;
  const sump = (o.sump ?? true) && primary;
  const cid = (i: number) => i + cylOffset;
  const diesel = fuel === 'diesel';
  const pitch = 0.105 * s;
  const len = Math.max(n * pitch + 0.1 * s, 0.34 * s);
  const zc = (i: number) => -((n - 1) * pitch) / 2 + (i - 1) * pitch;
  const zT = -len / 2; // timing end
  const metal = (c: number) => mat(c, { metalness: 0.65, roughness: 0.45 });
  const yCrank = y - 0.1 * s;
  const yHead = y + 0.2 * s;
  const yCam = y + 0.245 * s;

  // ---- Block, ribs, sump, head, cam cover
  const blockMat = metal(ALU);
  b.add('engine', at(new THREE.Mesh(new RoundedBoxGeometry(0.32 * s, 0.3 * s, len, 3, 0.03 * s), blockMat), x, y, 0));
  for (let i = 0; i <= n; i++) {
    const z = zc(1) - pitch / 2 + i * pitch;
    for (const side of [1, -1]) b.add('engine', at(box(0.012 * s, 0.26 * s, 0.012 * s, ALU, 0.004), x + side * 0.163 * s, y - 0.01 * s, z));
  }
  b.add('engine', at(box(0.36 * s, 0.04 * s, len + 0.02 * s, 0x8c929b, 0.01), x, y - 0.15 * s, 0)); // bedplate
  if (sump) b.add('engine', at(new THREE.Mesh(new RoundedBoxGeometry(0.3 * s, 0.1 * s, len * 0.86, 3, 0.03 * s), metal(0x5d636d)), x, y - 0.22 * s, 0)); // sump
  if (sump) b.add('oil_drain_plug', at(tf(new THREE.Mesh(new THREE.CylinderGeometry(0.016 * s, 0.016 * s, 0.02 * s, 6), metal(0xd4d4d8)), {}), x, y - 0.275 * s, len * 0.2));
  b.add('engine', at(new THREE.Mesh(new RoundedBoxGeometry(0.31 * s, 0.1 * s, len * 0.98, 3, 0.02 * s), metal(0x8a9099)), x, y + 0.2 * s, 0)); // head
  b.add('engine', at(box(0.33 * s, 0.012 * s, len * 0.99, 0x2b2f36, 0.004), x, y + 0.153 * s, 0)); // head gasket
  const cover = new THREE.Mesh(new RoundedBoxGeometry(0.27 * s, 0.07 * s, len * 0.94, 4, 0.03 * s), mat(BLACK, { metalness: 0.1, roughness: 0.55 }));
  b.add('engine', at(cover, x, y + 0.285 * s, 0));
  for (const dx of [-0.085, 0.085]) b.add('engine', at(box(0.012 * s, 0.012 * s, len * 0.8, 0x2a2e36, 0.004), x + dx * s, y + 0.322 * s, 0));
  if (primary) b.add('oil_filler_cap', at(cyl(0.028 * s, 0.028 * s, 0.025 * s, PALETTE.yellow), x - 0.06 * s, y + 0.33 * s, zT + len * 0.12));

  if (primary) {
  // ---- Crankshaft (main journals + counterweights) and flywheel
    const crank = new THREE.Group();
    crank.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022 * s, 0.022 * s, len + 0.16 * s, 16), metal(0xb8bec7)));
    for (let i = 1; i <= n; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s, 0.06 * s, 0.018 * s, 20, 1, false, 0, Math.PI), metal(0x7c828c));
      w.position.y = zc(i) - pitch * 0.3;
      w.rotation.y = pistonPhase(i, n);
      crank.add(w);
    }
    crank.rotation.x = Math.PI / 2;
    crank.userData.spin = 'y';
    b.add('engine', at(crank, x, yCrank, 0));
    const fly = new THREE.Group();
    fly.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.15 * s, 0.025 * s, 48), metal(0x9aa0a9)));
    fly.add(new THREE.Mesh(new THREE.TorusGeometry(0.152 * s, 0.006 * s, 6, 96), metal(0x6b7280)).rotateX(Math.PI / 2));
    fly.rotation.x = Math.PI / 2;
    fly.userData.spin = 'y';
    b.add('engine', at(fly, x, yCrank, len / 2 + 0.03 * s));
    // Crank position sensor reading the flywheel target ring
    b.add('crank_sensor', at(tf(cyl(0.013 * s, 0.013 * s, 0.05 * s, SENSOR), { rotation: [0, 0, Math.PI / 2] }), x + 0.19 * s, yCrank + 0.03 * s, len / 2 + 0.03 * s));
    b.add('crank_sensor', at(box(0.025 * s, 0.03 * s, 0.03 * s, BLACK, 0.004), x + 0.225 * s, yCrank + 0.03 * s, len / 2 + 0.03 * s));
  }

  // ---- Cylinders: liner, piston with rings, gudgeon pin and connecting rod (they move when highlighted)
  for (let i = 1; i <= n; i++) {
    const z = zc(i);
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(0.044 * s, 0.044 * s, 0.2 * s, 28, 1, true), mat(0xcbd5e1, { metalness: 0.8, roughness: 0.25, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    b.add(`cylinder_${cid(i)}`, at(liner, x, y + 0.04 * s, z));
    const piston = new THREE.Group();
    piston.add(new THREE.Mesh(new THREE.CylinderGeometry(0.041 * s, 0.041 * s, 0.05 * s, 28), metal(0xd6dae0)));
    for (const k of [0.015, 0.006, -0.003]) piston.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.041 * s, 0.0025 * s, 4, 28), mat(0x3f3f46)).rotateX(Math.PI / 2), 0, k * s, 0));
    if (!diesel) piston.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.041 * s, 24, 8, 0, Math.PI * 2, 0, 0.35), metal(0xd6dae0)), 0, 0.017 * s, 0));
    else piston.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.02 * s, 0.006 * s, 6, 20), mat(0x9ca3af)).rotateX(Math.PI / 2), 0, 0.025 * s, 0)); // bowl
    piston.add(tf(cyl(0.009 * s, 0.009 * s, 0.07 * s, 0x9ca3af, 10), { rotation: [0, 0, Math.PI / 2] }));
    const rod = new THREE.Mesh(new RoundedBoxGeometry(0.022 * s, 0.13 * s, 0.014 * s, 2, 0.005 * s), metal(0x8b9099));
    rod.position.y = -0.07 * s;
    piston.add(rod);
    piston.add(at(tf(cyl(0.028 * s, 0.028 * s, 0.02 * s, 0x8b9099, 16), { rotation: [Math.PI / 2, 0, 0] }), 0, -0.135 * s, 0));
    piston.userData.stroke = { amp: 0.035 * s, phase: pistonPhase(i, n) };
    b.add(`cylinder_${cid(i)}`, at(piston, x, y + 0.05 * s, z));
  }

  // ---- Camshafts with lobes (intake -X, exhaust +X), timing sprockets and chain
  for (const side of [-1, 1]) {
    const cam = new THREE.Group();
    cam.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012 * s, 0.012 * s, len * 0.95, 12), metal(0xc7ccd3)));
    for (let i = 1; i <= n; i++) {
      for (const dz of [-0.022, 0.022]) {
        const lobe = new THREE.Mesh(new RoundedBoxGeometry(0.03 * s, 0.012 * s, 0.04 * s, 2, 0.006 * s), metal(0xc7ccd3));
        lobe.position.set(0.008 * s, zc(i) + dz * s, 0);
        lobe.rotation.y = pistonPhase(i, n) / 2;
        cam.add(lobe);
      }
    }
    cam.rotation.x = Math.PI / 2;
    cam.userData.spin = 'y';
    b.add('timing_chain', at(cam, x + side * 0.065 * s, yCam, 0));
  }
  const camSpr: [number, number, number][] = [[x - 0.065 * s, yCam, 0.045 * s], [x + 0.065 * s, yCam, 0.045 * s], [x, yCrank, 0.026 * s]];
  for (const [cx, cy, r] of camSpr) b.add('timing_chain', at(pulley(r, 0.012 * s, 0x6b7280, false), cx, cy, zT - 0.02 * s));
  b.add('timing_chain', beltAround(camSpr, zT - 0.02 * s, 0.004 * s));
  b.add('timing_chain', at(tf(box(0.012 * s, 0.2 * s, 0.012 * s, 0x1f2937, 0.004), { rotation: [0, 0, 0.18] }), x - 0.06 * s, y + 0.06 * s, zT - 0.02 * s)); // guide
  b.add('timing_chain', at(tf(box(0.012 * s, 0.2 * s, 0.012 * s, 0x1f2937, 0.004), { rotation: [0, 0, -0.18] }), x + 0.06 * s, y + 0.06 * s, zT - 0.02 * s)); // tensioner rail

  // ---- Cam position sensor reading the target wheel on the intake cam (classic P0340 – P0349)
  const target = new THREE.Group();
  target.add(new THREE.Mesh(new THREE.CylinderGeometry(0.032 * s, 0.032 * s, 0.006 * s, 24), metal(0x9ca3af)));
  for (let k = 0; k < 4; k++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.014 * s, 0.006 * s, 0.012 * s * (k === 0 ? 2 : 1)), metal(0x9ca3af));
    const a = (k / 4) * Math.PI * 2;
    tooth.position.set(Math.cos(a) * 0.036 * s, 0, Math.sin(a) * 0.036 * s);
    tooth.rotation.y = -a;
    target.add(tooth);
  }
  target.rotation.x = Math.PI / 2;
  target.userData.spin = 'y';
  b.add('cam_sensor', at(target, x - 0.065 * s, yCam, zT + 0.012 * s));
  b.add('cam_sensor', at(cyl(0.011 * s, 0.011 * s, 0.045 * s, SENSOR), x - 0.065 * s, yCam + 0.062 * s, zT + 0.012 * s));
  b.add('cam_sensor', at(box(0.022 * s, 0.018 * s, 0.03 * s, BLACK, 0.004), x - 0.065 * s, yCam + 0.093 * s, zT + 0.012 * s));
  b.add('cam_sensor', at(box(0.04 * s, 0.006 * s, 0.02 * s, 0x6b7280, 0.002), x - 0.065 * s, yCam + 0.045 * s, zT + 0.012 * s)); // flange + bolt
  b.add('cam_sensor', tube([[x - 0.065 * s, yCam + 0.1 * s, zT + 0.012 * s], [x - 0.1 * s, yCam + 0.12 * s, zT + 0.05 * s], [x - 0.16 * s, yCam + 0.1 * s, zT + 0.1 * s]], 0.004 * s, 0x111827));
  // VVT oil control solenoid next to it
  b.add('vvt_solenoid', at(tf(cyl(0.014 * s, 0.014 * s, 0.05 * s, 0x8b5cf6), { rotation: [Math.PI / 2, 0, 0] }), x - 0.12 * s, yHead, zT + 0.02 * s));
  b.add('vvt_solenoid', at(box(0.02 * s, 0.02 * s, 0.02 * s, BLACK, 0.004), x - 0.12 * s, yHead, zT - 0.012 * s));

  // ---- Ignition (petrol): spark plugs in their wells, pencil coils with connectors; diesel: glow plugs
  for (let i = 1; i <= n; i++) {
    const z = zc(i);
    if (diesel) {
      b.add('glow_plugs', at(tf(cyl(0.006 * s, 0.006 * s, 0.11 * s, PALETTE.copper), { rotation: [0, 0, 0.5] }), x - 0.11 * s, yHead + 0.01 * s, z + 0.02 * s));
      b.add('glow_plugs', at(cyl(0.008 * s, 0.008 * s, 0.012 * s, 0x6b7280), x - 0.135 * s, yHead + 0.055 * s, z + 0.02 * s));
      continue;
    }
    const plug = new THREE.Group();
    plug.add(at(cyl(0.006 * s, 0.006 * s, 0.02 * s, 0x9ca3af, 10), 0, -0.035 * s, 0)); // thread
    plug.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.011 * s, 0.011 * s, 0.012 * s, 6), metal(0xd4d4d8)), 0, -0.02 * s, 0)); // hex
    plug.add(at(cyl(0.007 * s, 0.006 * s, 0.04 * s, 0xf5f5f4, 12), 0, 0.006 * s, 0)); // ceramic
    plug.add(at(cyl(0.003 * s, 0.003 * s, 0.01 * s, 0x9ca3af, 8), 0, 0.03 * s, 0)); // terminal
    b.add(`spark_plug_${cid(i)}`, at(plug, x, yHead + 0.01 * s, z));
    b.add(`coil_${cid(i)}`, at(cyl(0.013 * s, 0.013 * s, 0.1 * s, 0x1f2937, 14), x, y + 0.28 * s, z)); // pencil boot
    b.add(`coil_${cid(i)}`, at(box(0.06 * s, 0.035 * s, 0.045 * s, 0x111827, 0.008 * s), x + 0.012 * s, y + 0.345 * s, z));
    b.add(`coil_${cid(i)}`, at(box(0.02 * s, 0.022 * s, 0.026 * s, 0x374151, 0.004), x + 0.05 * s, y + 0.345 * s, z)); // connector
    b.add(`coil_${cid(i)}`, at(cyl(0.004 * s, 0.004 * s, 0.03 * s, 0x6b7280, 6), x - 0.02 * s, y + 0.36 * s, z + 0.018 * s)); // bolt
  }
  if (!diesel) b.add('engine', tube([[x + 0.06 * s, y + 0.355 * s, zc(1) - 0.04 * s], [x + 0.065 * s, y + 0.36 * s, 0], [x + 0.06 * s, y + 0.355 * s, zc(n) + 0.03 * s]], 0.006 * s, 0x111827)); // coil harness

  // ---- Fuel injection: common rail + injectors (direct injection, diesel on top / petrol on the intake side)
  for (let i = 1; i <= n; i++) {
    const z = zc(i);
    const inj = new THREE.Group();
    inj.add(cyl(0.011 * s, 0.009 * s, 0.075 * s, 0xb6c2cf, 14));
    inj.add(at(cyl(0.004 * s, 0.003 * s, 0.015 * s, 0x6b7280, 8), 0, -0.044 * s, 0)); // nozzle
    inj.add(at(box(0.024 * s, 0.018 * s, 0.022 * s, BLACK, 0.004), 0.012 * s, 0.03 * s, 0)); // connector
    inj.add(at(cyl(0.012 * s, 0.012 * s, 0.006 * s, 0x84cc16, 14), 0, 0.012 * s, 0)); // seal / clip
    if (diesel) b.add(`injector_${cid(i)}`, at(tf(inj, { rotation: [0, 0, 0.1] }), x + 0.005 * s, y + 0.3 * s, z + 0.03 * s));
    else b.add(`injector_${cid(i)}`, at(tf(inj, { rotation: [0, 0, 0.75] }), x - 0.17 * s, yHead - 0.01 * s, z));
  }
  const railX = diesel ? x - 0.035 * s : x - 0.205 * s;
  const railY = diesel ? y + 0.36 * s : yHead + 0.03 * s;
  b.add('fuel_rail', at(tf(cyl(0.013 * s, 0.013 * s, len * 0.88, 0x9ca3af, 14), { rotation: [Math.PI / 2, 0, 0] }), railX, railY, 0));
  b.add('fuel_rail', at(box(0.02 * s, 0.03 * s, 0.03 * s, SENSOR, 0.004), railX, railY + 0.02 * s, len * 0.42)); // rail pressure sensor
  if (diesel) for (let i = 1; i <= n; i++) b.add('fuel_rail', tube([[railX, railY, zc(i)], [x - 0.01 * s, y + 0.355 * s, zc(i) + 0.03 * s]], 0.004 * s, 0x9ca3af));
  // High-pressure pump driven by the exhaust camshaft at the timing end
  if (primary) b.add('fuel_rail', at(new THREE.Mesh(new RoundedBoxGeometry(0.06 * s, 0.07 * s, 0.06 * s, 2, 0.012 * s), metal(0x9aa0a8)), x + 0.07 * s, y + 0.29 * s, zT - 0.02 * s));
  b.add('fuel_rail', tube([[x + 0.07 * s, y + 0.33 * s, zT - 0.02 * s], [railX, railY + 0.03 * s, zT + 0.02 * s], [railX, railY, -len * 0.42]], 0.004 * s, 0x9ca3af));

  // ---- Intake: plenum, runners, throttle body, MAP sensor
  if (intake) {
    const px = x - 0.33 * s;
    const py = y + 0.12 * s;
    b.add('intake_manifold', at(new THREE.Mesh(new RoundedBoxGeometry(0.09 * s, 0.1 * s, len * 0.95, 3, 0.03 * s), mat(0x262a31, { roughness: 0.6 })), px, py, 0));
    for (let i = 1; i <= n; i++) {
      b.add('intake_manifold', tube([[px + 0.03 * s, py + 0.04 * s, zc(i)], [px + 0.04 * s, py + 0.13 * s, zc(i)], [x - 0.2 * s, y + 0.24 * s, zc(i)], [x - 0.155 * s, yHead, zc(i)]], 0.02 * s, 0x2c3038));
    }
    b.add('throttle_body', at(tf(cyl(0.035 * s, 0.035 * s, 0.05 * s, ALU, 20), { rotation: [Math.PI / 2, 0, 0] }), px, py, len / 2 + 0.02 * s));
    b.add('throttle_body', at(box(0.05 * s, 0.05 * s, 0.03 * s, BLACK, 0.006), px - 0.04 * s, py, len / 2 + 0.02 * s)); // actuator
    b.add('map_sensor', at(box(0.03 * s, 0.022 * s, 0.03 * s, SENSOR, 0.004), px, py + 0.06 * s, len * 0.3));
    b.add('swirl_flaps', at(box(0.02 * s, 0.02 * s, len * 0.85, 0xa16207, 0.004), px + 0.05 * s, py + 0.1 * s, 0));
  }

  // ---- Exhaust manifold, heat shield, turbocharger
  const mx = x + 0.27 * s;
  const my = y + 0.06 * s;
  for (let i = 1; i <= n; i++) b.add('exhaust', tube([[x + 0.155 * s, yHead - 0.01 * s, zc(i)], [x + 0.22 * s, yHead - 0.03 * s, zc(i) * 0.8], [mx, my, zc(i) * 0.3], [mx, my - 0.02 * s, 0]], 0.017 * s, 0x6b5f57));
  b.add('exhaust', at(new THREE.Mesh(new RoundedBoxGeometry(0.02 * s, 0.14 * s, len * 0.8, 2, 0.008 * s), metal(0xc0c4ca)), x + 0.3 * s, yHead - 0.02 * s, 0)); // heat shield
  b.add('o2_sensor_upstream', at(tf(cyl(0.01 * s, 0.01 * s, 0.05 * s, 0xf472b6), { rotation: [0, 0, -0.6] }), mx + 0.03 * s, my + 0.03 * s, -0.04 * s));
  let exhaustOut: [number, number, number] = [mx, my - 0.08 * s, 0];
  if (turbo) {
    const tx = x + 0.3 * s;
    const ty = y - 0.04 * s;
    const tz = 0.02 * s;
    // Turbine side (cast iron snail) and centre housing
    b.add('turbo', at(new THREE.Mesh(new THREE.TorusGeometry(0.04 * s, 0.026 * s, 12, 32, Math.PI * 1.7), metal(0x5b4636)), tx, ty, tz));
    b.add('turbo', at(tf(cyl(0.035 * s, 0.035 * s, 0.05 * s, 0x5b4636, 24), { rotation: [Math.PI / 2, 0, 0] }), tx, ty, tz));
    b.add('turbo', at(tf(cyl(0.022 * s, 0.022 * s, 0.05 * s, 0x8a8f98, 16), { rotation: [Math.PI / 2, 0, 0] }), tx, ty, tz + 0.05 * s));
    // Compressor side (aluminium snail) with a visible spinning wheel
    b.add('turbo', at(new THREE.Mesh(new THREE.TorusGeometry(0.042 * s, 0.024 * s, 12, 32, Math.PI * 1.7), metal(0xc4c9d0)), tx, ty, tz + 0.09 * s));
    b.add('turbo', at(tf(new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.04 * s, 24, 1, true), metal(0xc4c9d0)), { rotation: [Math.PI / 2, 0, 0] }), tx, ty, tz + 0.12 * s));
    const wheelC = new THREE.Group();
    for (let k = 0; k < 8; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.002 * s, 0.024 * s, 0.03 * s), metal(0xe5e7eb));
      blade.rotation.y = (k / 8) * Math.PI * 2;
      blade.rotation.z = 0.4;
      wheelC.add(blade);
    }
    wheelC.rotation.x = Math.PI / 2;
    wheelC.userData.spin = 'y';
    b.add('turbo', at(wheelC, tx, ty, tz + 0.12 * s));
    // Wastegate actuator (can + rod)
    b.add('turbo', at(cyl(0.022 * s, 0.022 * s, 0.03 * s, 0x9ca3af, 20), tx + 0.05 * s, ty + 0.04 * s, tz + 0.09 * s));
    b.add('turbo', tube([[tx + 0.05 * s, ty + 0.02 * s, tz + 0.09 * s], [tx + 0.045 * s, ty - 0.03 * s, tz + 0.02 * s]], 0.003 * s, 0xd4d4d8));
    // Oil feed line
    b.add('turbo', tube([[x + 0.16 * s, y + 0.05 * s, 0.08 * s], [tx - 0.01 * s, ty + 0.04 * s, tz + 0.05 * s]], 0.004 * s, 0x9ca3af));
    exhaustOut = [tx, ty - 0.07 * s, tz];
  }

  // ---- Lubrication & cooling: oil filter, sensors, dipstick, thermostat housing
  if (primary) {
    b.add('oil_filter', at(tf(cyl(0.04 * s, 0.04 * s, 0.09 * s, 0x2563eb, 24), { rotation: [0, 0, Math.PI / 2] }), x + 0.21 * s, y - 0.07 * s, len * 0.28));
    b.add('oil_filter', at(tf(new THREE.Mesh(new THREE.CylinderGeometry(0.041 * s, 0.041 * s, 0.012 * s, 12), mat(0x1d4ed8)), { rotation: [0, 0, Math.PI / 2] }), x + 0.258 * s, y - 0.07 * s, len * 0.28));
    b.add('oil_pressure_sensor', at(tf(cyl(0.01 * s, 0.01 * s, 0.04 * s, 0xf59e0b), { rotation: [0, 0, Math.PI / 2] }), x + 0.18 * s, y - 0.01 * s, len * 0.1));
    b.add('knock_sensor', at(tf(cyl(0.02 * s, 0.02 * s, 0.015 * s, SENSOR), { rotation: [0, 0, Math.PI / 2] }), x - 0.168 * s, y - 0.02 * s, 0));
    b.add('knock_sensor', at(tf(cyl(0.005 * s, 0.005 * s, 0.03 * s, 0x9ca3af), { rotation: [0, 0, Math.PI / 2] }), x - 0.17 * s, y - 0.02 * s, 0));
    b.add('dipstick', tube([[x - 0.15 * s, y - 0.12 * s, len * 0.15], [x - 0.2 * s, y + 0.1 * s, len * 0.18], [x - 0.2 * s, y + 0.32 * s, len * 0.2]], 0.006 * s, 0x9ca3af));
    b.add('dipstick', at(new THREE.Mesh(new THREE.TorusGeometry(0.014 * s, 0.005 * s, 6, 16), mat(PALETTE.yellow)), x - 0.2 * s, y + 0.345 * s, len * 0.2));
    b.add('thermostat', at(new THREE.Mesh(new RoundedBoxGeometry(0.05 * s, 0.05 * s, 0.05 * s, 2, 0.01 * s), metal(0x9aa0a8)), x + 0.12 * s, yHead, zT + 0.03 * s));
    b.add('thermostat', tube([[x + 0.12 * s, yHead + 0.02 * s, zT + 0.01 * s], [x + 0.2 * s, yHead + 0.05 * s, zT - 0.05 * s]], 0.014 * s, 0x111827));
    b.add('coolant_temp_sensor', at(cyl(0.008 * s, 0.008 * s, 0.035 * s, 0x06b6d4), x + 0.14 * s, yHead + 0.04 * s, zT + 0.04 * s));
  }

  // ---- Accessory drive (front-end): crank damper, water pump, alternator, A/C, tensioner, ribbed belt
  if (accessories) {
    const zb = zT - 0.065 * s;
    const P = {
      crank: [x, yCrank, 0.055 * s] as [number, number, number],
      wp: [x + 0.05 * s, y + 0.07 * s, 0.035 * s] as [number, number, number],
      alt: [x + 0.23 * s, y + 0.14 * s, 0.027 * s] as [number, number, number],
      ac: [x + 0.24 * s, y - 0.15 * s, 0.04 * s] as [number, number, number],
      tens: [x + 0.15 * s, y - 0.0 * s, 0.022 * s] as [number, number, number],
    };
    b.add('engine', at(pulley(P.crank[2], 0.03 * s, 0x2f3238), P.crank[0], P.crank[1], zb));
    b.add('engine', at(pulley(P.wp[2], 0.025 * s), P.wp[0], P.wp[1], zb));
    b.add('accessory_belt', at(pulley(P.tens[2], 0.026 * s, 0x9ca3af, false), P.tens[0], P.tens[1], zb));
    b.add('accessory_belt', at(tf(box(0.06 * s, 0.014 * s, 0.012 * s, 0x6b7280, 0.004), { rotation: [0, 0, 0.6] }), P.tens[0] - 0.02 * s, P.tens[1] + 0.02 * s, zb + 0.02 * s));
    b.add('accessory_belt', beltAround([P.crank, P.wp, P.alt, P.ac], zb, 0.006 * s));
    // Alternator: finned body, rear cover, B+ terminal and connector
    const [ax, ay] = P.alt;
    b.add('alternator', at(pulley(P.alt[2], 0.026 * s), ax, ay, zb));
    b.add('alternator', at(tf(cyl(0.06 * s, 0.06 * s, 0.11 * s, 0xb9bec6, 28), { rotation: [Math.PI / 2, 0, 0] }), ax, ay, zb + 0.08 * s));
    for (let k = 0; k < 5; k++) b.add('alternator', at(tf(new THREE.Mesh(new THREE.TorusGeometry(0.06 * s, 0.003 * s, 4, 28), metal(0x6b7280)), {}), ax, ay, zb + 0.04 * s + k * 0.018 * s));
    b.add('alternator', at(tf(cyl(0.05 * s, 0.05 * s, 0.025 * s, 0x2b2f36, 24), { rotation: [Math.PI / 2, 0, 0] }), ax, ay, zb + 0.145 * s));
    b.add('alternator', at(cyl(0.006 * s, 0.006 * s, 0.02 * s, 0xdc2626, 8), ax + 0.02 * s, ay + 0.03 * s, zb + 0.16 * s));
    b.add('alternator', at(box(0.02 * s, 0.015 * s, 0.015 * s, BLACK, 0.003), ax - 0.025 * s, ay + 0.02 * s, zb + 0.16 * s));
    // A/C compressor
    const [cx2, cy2] = P.ac;
    b.add('ac_compressor', at(pulley(P.ac[2], 0.026 * s, 0x2f3238), cx2, cy2, zb));
    b.add('ac_compressor', at(tf(cyl(0.05 * s, 0.05 * s, 0.13 * s, 0xc4c9d0, 24), { rotation: [Math.PI / 2, 0, 0] }), cx2, cy2, zb + 0.085 * s));
    b.add('ac_compressor', at(box(0.025 * s, 0.025 * s, 0.025 * s, BLACK, 0.004), cx2, cy2 + 0.055 * s, zb + 0.1 * s));
  }
  return { len, exhaustOut };
}

/**
 * Engine layout from the description: V (two banks), boxer (flat, opposed banks) or inline.
 * Returns the half-angle of the banks from vertical (0 = inline).
 */
export function engineLayout(spec: VehicleSpec): number {
  const n = spec.cylinders || 4;
  const e = `${spec.make ?? ''} ${spec.engine ?? ''}`.toLowerCase();
  // Porsche 911 / Boxster / Cayman (rear or mid engine) and Subaru use flat (boxer) engines.
  const porscheFlat = spec.make === 'Porsche' && (spec.enginePosition === 'rear' || spec.enginePosition === 'mid') && (n === 4 || n === 6);
  if (/subaru|boxer|flat/.test(e) || porscheFlat) return Math.PI / 2 - 0.08;
  if (/\bw12\b/.test(e)) return 0.55;
  if (n >= 8 || /\bv\s?(6|8|10|12)\b/.test(e)) return 0.72;
  return 0;
}

/**
 * Inline engine, or two mirrored banks around a common crankshaft for V and boxer engines
 * (cylinders 1..n/2 on the first bank, the rest on the second; one sump, one accessory drive).
 */
function engineAssembly(b: Builder, x: number, y: number, n: number, fuel: string, s: number, o: EngineOpts & { bank?: number }): EngineResult {
  const half = o.bank ?? 0;
  if (!half || n < 4) return engine(b, x, y, n, fuel, s, o);
  const nA = Math.ceil(n / 2);
  const yC = y - 0.1 * s;
  const bankBuilder = (sign: 1 | -1): Builder => ({
    root: b.root,
    add(id, obj) {
      const g = new THREE.Group();
      g.add(obj);
      g.position.set(x, yC, 0);
      g.rotation.z = -sign * half;
      if (sign < 0) g.scale.x = -1;
      return b.add(id, g);
    },
  });
  const a = engine(bankBuilder(1), 0, 0.1 * s, nA, fuel, s, { ...o, intake: false, sump: false });
  engine(bankBuilder(-1), 0, 0.1 * s, n - nA, fuel, s, { ...o, intake: false, primary: false, cylOffset: nA });
  // Central sump and, for V engines, the intake plenum in the valley
  b.add('engine', at(new THREE.Mesh(new RoundedBoxGeometry(0.42 * s, 0.1 * s, a.len * 0.9, 3, 0.03 * s), mat(0x5d636d, { metalness: 0.65, roughness: 0.45 })), x, yC - 0.12 * s, 0));
  b.add('oil_drain_plug', at(cyl(0.016 * s, 0.016 * s, 0.02 * s, 0xd4d4d8, 6), x, yC - 0.175 * s, a.len * 0.2));
  if (half < 1.2 && (o.intake ?? true)) {
    const py = yC + 0.33 * s * Math.cos(half) + 0.05 * s;
    b.add('intake_manifold', at(new THREE.Mesh(new RoundedBoxGeometry(0.16 * s, 0.09 * s, a.len * 0.95, 3, 0.03 * s), mat(0x262a31, { roughness: 0.6 })), x, py, 0));
    b.add('throttle_body', at(tf(cyl(0.035 * s, 0.035 * s, 0.05 * s, 0xa7adb6, 20), { rotation: [Math.PI / 2, 0, 0] }), x, py, a.len / 2 + 0.03 * s));
    b.add('map_sensor', at(box(0.03 * s, 0.022 * s, 0.03 * s, 0x10b981, 0.004), x, py + 0.055 * s, a.len * 0.3));
  }
  // Bank-A exhaust outlet to world coordinates
  const [lx, ly, lz] = a.exhaustOut;
  const c = Math.cos(-half), sn = Math.sin(-half);
  return { len: a.len, exhaustOut: [x + lx * c - ly * sn, yC + lx * sn + ly * c, lz] };
}

function addHeadlights(b: Builder, x: number, y: number, zs: number[]) {
  for (const z of zs) {
    const l = box(0.05, 0.1, 0.24, 0xfef9c3, 0.03);
    (l.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xfef3c7);
    (l.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
    b.add('headlights', at(l, x, y, z));
  }
}

/** Chassis parts common to all cars: hubs/bearings, shocks + springs, drive shafts. */
function chassis(b: Builder, o: { W: number; wr: number; axleF: number; axleR: number; driven: 'front' | 'rear' | 'both'; top?: number }) {
  const { W, wr, axleF, axleR } = o;
  // Strut top under the bonnet / wing line (low sports cars)
  const k = Math.min(1, ((o.top ?? 2) - wr - 0.05) / 0.68);
  const corners: [string, number, number][] = [['fl', axleF, W - 0.05], ['fr', axleF, -W + 0.05], ['rl', axleR, W - 0.05], ['rr', axleR, -W + 0.05]];
  for (const [s, x, z] of corners) {
    const sz = Math.sign(z);
    b.add(`wheel_bearing_${s}`, at(tf(cyl(0.07, 0.07, 0.07, 0x9ca3af, 20), { rotation: [Math.PI / 2, 0, 0] }), x, wr, z - sz * 0.2));
    // Shock absorber with coil spring
    const shockX = x + (x > 0 ? -0.06 : 0.06);
    const zS = z - sz * 0.27;
    b.add(`shock_${s}`, at(cyl(0.03, 0.03, 0.5 * k, 0x52525b), shockX, wr + 0.07 + 0.25 * k, zS));
    b.add(`shock_${s}`, at(cyl(0.018, 0.018, 0.2 * k, 0xd4d4d8), shockX, wr + 0.07 + 0.56 * k, zS));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 90; i++) {
      const a = (i / 90) * Math.PI * 2 * 6;
      pts.push(new THREE.Vector3(shockX + Math.cos(a) * 0.065, wr + 0.12 + (i / 90) * 0.42 * k, zS + Math.sin(a) * 0.065));
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

/** Turbocharged? Diesels yes; petrol unless the engine name points to a naturally aspirated unit. */
export function hasTurbo(spec: VehicleSpec) {
  if (spec.fuel === 'diesel') return true;
  const e = `${spec.make ?? ''} ${spec.engine ?? ''}`.toLowerCase();
  if (/toyota|lexus|mazda|skyactiv-g|\bsce\b|\bvti\b|atmo|i-vtec|puretech (68|72|75|82)|1\.0 (sce|mpi)|mpi/.test(e)) return false;
  return true;
}

function carLike(spec: VehicleSpec, style: CarStyle): THREE.Group {
  const b = builder();
  const st = CAR_STYLES[style];
  const { L, W, wr, belt } = st;
  const axleF = L - st.aF;
  const axleR = -L + st.aR;
  const hoodEnd = L - st.hood;
  const dash = hoodEnd - st.ws - 0.05;
  const electric = spec.fuel === 'electric';
  b.root.add(carBody(st, axleF, axleR, paintFor(spec.make ?? '')));

  const corners: [string, number, number][] = [['fl', axleF, W - 0.05], ['fr', axleF, -W + 0.05], ['rl', axleR, W - 0.05], ['rr', axleR, -W + 0.05]];
  for (const [s, x, z] of corners) {
    b.add(`wheel_${s}`, at(wheel(wr, style === 'van' || style === 'pickup' ? 0.24 : 0.22, z > 0), x, wr, z));
    b.add(`wheel_speed_sensor_${s}`, at(box(0.04, 0.06, 0.04, 0x10b981, 0.01), x - 0.12, wr + 0.12, z - Math.sign(z) * 0.14));
    b.add(`brake_${s}`, at(brakeDisc(wr, s.startsWith('r') ? 0.85 : 1), x, wr, z - Math.sign(z) * 0.13));
  }
  const driven = (['front', 'rear', 'both'].includes(spec.traction ?? '') ? spec.traction : 'front') as 'front' | 'rear' | 'both';
  chassis(b, { W, wr, axleF, axleR, driven, top: belt - 0.08 });

  const pos = spec.enginePosition === 'mid' || spec.enginePosition === 'rear' ? spec.enginePosition : 'front';
  // Front: over the front axle. Mid: between the seats and the rear axle. Rear: overhanging the rear axle (911).
  const ex = pos === 'mid' ? axleR + 0.74 : pos === 'rear' ? axleR - 0.2 : axleF + 0.05;
  const ey = Math.min(0.58, belt - 0.46); // low-slung coupés: keep the engine under the bonnet
  // Common to all energies (engine-bay parts are placed relative to the scuttle so every style fits)
  const radH = Math.min(0.42, belt - st.low - 0.3);
  const radY = st.low + 0.08 + radH / 2;
  b.add('radiator', at(box(0.06, radH, W * 1.5, 0x64748b, 0.02), L - 0.22, radY, 0));
  b.add('cooling_fan', at(tf(fan(Math.min(0.18, radH / 2.2)), { rotation: [0, Math.PI / 2, 0] }), L - 0.3, radY, -0.2));
  b.add('brake_fluid_reservoir', at(box(0.08, 0.08, 0.1, 0xfef08a, 0.02), hoodEnd + 0.05, ey + 0.32, W - 0.35));
  b.add('washer_reservoir', at(box(0.14, 0.18, 0.14, 0x60a5fa, 0.03), L - 0.35, Math.min(0.65, belt - 0.3), W - 0.28));
  b.add('battery', at(box(0.24, 0.18, 0.17, 0x111827, 0.02), ex - 0.15, ey + 0.06, -W + 0.28));
  b.add('battery', at(cyl(0.015, 0.015, 0.03, 0xef4444), ex - 0.08, ey + 0.17, -W + 0.24));
  const ecuX = hoodEnd - 0.02;
  b.add('ecu', at(box(0.2, 0.05, 0.16, 0x0f766e, 0.01), ecuX, ey + 0.2, -W + 0.3));
  b.add('abs_module', at(box(0.14, 0.12, 0.12, 0x6b7280, 0.02), hoodEnd + 0.03, ey + 0.1, W - 0.2));
  b.add('cabin_filter', at(box(0.22, 0.03, 0.3, 0xfde68a, 0.01), hoodEnd - 0.12, Math.min(ey + 0.38, belt - 0.06), 0));
  addHeadlights(b, L - 0.05, st.low + (belt - (st.wedge ?? 0) - st.low) * 0.6, [W - 0.25, -W + 0.25]);
  const wiper = box(0.03, 0.02, 0.5, 0x0f172a, 0.005);
  wiper.rotation.z = -0.5;
  b.add('wiper_blades', at(wiper, hoodEnd - 0.05, belt + 0.05, 0.2));
  b.add('wiper_blades', at(wiper.clone(), hoodEnd - 0.05, belt + 0.05, -0.35));
  b.add('cabin', at(box(0.3, 0.18, W * 1.6, 0x1e293b, 0.05), dash, belt - 0.07, 0));
  const seatX = dash - 0.55;
  for (const z of [0.38, -0.38]) {
    b.add('cabin', at(box(0.45, 0.08, 0.42, 0x1e293b, 0.04), seatX, 0.55, z * (W / 0.85)));
    b.add('cabin', at(tf(box(0.08, 0.5, 0.42, 0x1e293b, 0.04), { rotation: [0, 0, 0.2] }), seatX - 0.24, 0.82, z * (W / 0.85)));
  }
  b.add('can_bus', tube([[ecuX, ey + 0.2, -W + 0.3], [dash + 0.1, belt - 0.12, -0.2], [dash, belt - 0.07, 0.3], [hoodEnd + 0.03, ey + 0.1, W - 0.2]], 0.01, 0xf59e0b));
  b.add('can_bus', tube([[dash, belt - 0.07, 0], [axleR + 0.3, 0.6, 0.0], [axleR, wr + 0.2, W - 0.2]], 0.01, 0xf59e0b));

  // Cabin controls and safety
  const wheelX = dash + 0.05;
  const sz = W - 0.45;
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 10, 32), mat(0x111827, { roughness: 0.7 }));
  sw.rotation.y = Math.PI / 2;
  sw.rotation.x = 0.35;
  const swY = belt - 0.04;
  b.add('airbag', at(sw, wheelX, swY, sz));
  b.add('airbag', at(tf(cyl(0.07, 0.07, 0.05, 0x1f2937), { rotation: [0, 0, Math.PI / 2 - 0.35] }), wheelX + 0.02, swY, sz));
  b.add('steering_angle', at(tf(cyl(0.05, 0.05, 0.04, 0x10b981), { rotation: [0, 0, Math.PI / 2 - 0.35] }), wheelX + 0.12, swY - 0.05, sz));
  b.add('accelerator_pedal', at(box(0.04, 0.12, 0.06, 0x374151, 0.01), dash + 0.25, 0.42, W - 0.62));
  b.add('brake_switch', at(box(0.05, 0.13, 0.08, 0x111827, 0.01), dash + 0.25, 0.44, sz));
  b.add('brake_switch', at(cyl(0.015, 0.015, 0.05, 0x10b981), dash + 0.3, 0.55, sz));

  if (electric) {
    // Electric A/C compressor (no belt)
    b.add('ac_compressor', at(tf(cyl(0.07, 0.07, 0.14, 0x9ca3af), { rotation: [Math.PI / 2, 0, 0] }), ex + 0.2, 0.42, -0.35));
    evPowertrain(b, { L, W, wr, axleF, axleR, driven });
    return b.root;
  }
  const n = spec.cylinders;
  // Engine length along the crank: one bank for V / boxer engines.
  const nRow = engineLayout(spec) ? Math.ceil(n / 2) : n;
  const gearZ = Math.max(nRow * 0.055, 0.2);
  b.add('starter', at(tf(cyl(0.05, 0.05, 0.18, 0x6b7280), { rotation: [Math.PI / 2, 0, 0] }), ex - 0.18, 0.45, gearZ + 0.12));
  b.add('egt_sensor', at(cyl(0.012, 0.012, 0.08, 0xf472b6), axleF - 0.62, 0.32, -0.12));

  // ---- Combustion / hybrid powertrain (transverse engine)
  const bank = engineLayout(spec);
  const { exhaustOut } = engineAssembly(b, ex, ey, n, spec.fuel, bank ? 0.9 : 1, { turbo: hasTurbo(spec), bank });
  b.add('transmission', at(box(0.42, 0.34, 0.32, 0x52525b, 0.05), ex - 0.05, 0.6, gearZ + 0.3));
  b.add('vehicle_speed_sensor', at(cyl(0.02, 0.02, 0.06, 0x10b981), ex - 0.25, 0.55, 0.5));
  b.add('clutch_slave', at(tf(cyl(0.025, 0.025, 0.09, 0xa3e635), { rotation: [0, 0, Math.PI / 2] }), ex - 0.3, 0.62, gearZ + 0.22));
  b.add('clutch_master', at(cyl(0.022, 0.022, 0.08, 0xa3e635), hoodEnd - 0.05, ey + 0.2, W - 0.4));
  b.add('clutch_master', tube([[hoodEnd - 0.05, ey + 0.16, W - 0.4], [ex - 0.45, 0.62, W - 0.55], [ex - 0.3, 0.62, gearZ + 0.22]], 0.006, 0x111827));
  b.add('air_filter', at(box(0.32, 0.14, 0.26, 0x1f2937, 0.04), ex + 0.25, ey + 0.32, -W + 0.32));
  b.add('maf_sensor', at(tf(cyl(0.045, 0.045, 0.1, 0xf97316), { rotation: [Math.PI / 2, 0, 0] }), ex + 0.08, ey + 0.32, -W + 0.52));
  b.add('iat_sensor', at(cyl(0.01, 0.01, 0.04, 0xf97316), ex + 0.08, ey + 0.38, -W + 0.52));
  b.add('vacuum_hoses', tube([[ex + 0.05, ey + 0.32, -W + 0.6], [ex - 0.15, ey + 0.36, -0.1], [ex - 0.3, ey + 0.26, nRow * 0.055 + 0.1]], 0.04, 0x111827));
  b.add('vacuum_hoses', tube([[ex - 0.36, ey + 0.26, -0.1], [ex - 0.25, ey + 0.4, -0.2], [ex - 0.05, ey + 0.36, -0.15]], 0.012, 0x111827));
  b.add('purge_valve', at(cyl(0.025, 0.025, 0.05, 0x22c55e), ex - 0.4, ey + 0.32, -0.2));
  b.add('egr_valve', at(box(0.08, 0.08, 0.08, 0x78716c, 0.02), ex - 0.3, ey + 0.3, -0.18));
  b.add('coolant_reservoir', at(box(0.12, 0.12, 0.14, 0xe0f2fe, 0.03), ex + 0.2, ey + 0.3, W - 0.3));
  b.add('intercooler', at(box(0.06, 0.18, W * 1.2, 0x475569, 0.02), L - 0.12, 0.38, 0));

  const yUnder = 0.24;
  const front = pos === 'front';
  // Front engine: catalyst under the floor. Mid / rear engine: catalyst right behind the engine, silencer at the tail.
  const catX = front ? axleF - 0.8 : Math.max(ex - 0.42, -L + 0.62);
  b.add('exhaust', tube([exhaustOut, [exhaustOut[0] + 0.02, Math.max(yUnder + 0.1, exhaustOut[1] - 0.15), -0.05], [catX + 0.35, yUnder, -0.1], [catX + 0.2, yUnder, -0.12]], 0.035, PALETTE.exhaust));
  b.add('catalytic_converter', at(tf(cyl(0.09, 0.09, 0.36, 0xa8a29e, 24), { rotation: [0, 0, Math.PI / 2] }), catX, yUnder, -0.12));
  b.add('o2_sensor_downstream', at(cyl(0.015, 0.015, 0.08, 0xf472b6), catX - 0.23, yUnder + 0.08, -0.12));
  const dpfX = axleF - 1.35;
  if (spec.fuel === 'diesel') {
    b.add('nox_sensor', at(box(0.06, 0.04, 0.05, 0x10b981, 0.01), dpfX - 0.3, yUnder + 0.1, -0.2));
    b.add('egt_sensor', at(cyl(0.012, 0.012, 0.08, 0xf472b6), dpfX + 0.24, yUnder + 0.08, -0.12));
    b.add('dpf', at(tf(cyl(0.1, 0.1, 0.4, 0x57534e, 24), { rotation: [0, 0, Math.PI / 2] }), dpfX, yUnder, -0.12));
    b.add('dpf_pressure_sensor', at(box(0.05, 0.04, 0.04, 0x10b981, 0.01), dpfX, yUnder + 0.16, -0.25));
    b.add('dpf_pressure_sensor', tube([[dpfX - 0.18, yUnder + 0.08, -0.12], [dpfX, yUnder + 0.16, -0.25], [dpfX + 0.18, yUnder + 0.08, -0.12]], 0.008, 0x111827));
    b.add('adblue_tank', at(box(0.22, 0.2, 0.2, 0x38bdf8, 0.04), axleR + 0.15, 0.4, -W + 0.3));
  }
  if (front) b.add('exhaust', tube([[axleF - 0.98, yUnder, -0.12], [dpfX - 0.3, yUnder, -0.12], [axleR + 0.1, yUnder + 0.05, -0.3], [-L + 0.35, yUnder + 0.05, -0.35]], 0.03, PALETTE.exhaust));
  else b.add('exhaust', tube([[catX - 0.18, yUnder, -0.12], [-L + 0.4, yUnder + 0.05, -0.3]], 0.03, PALETTE.exhaust));
  b.add('exhaust', at(tf(cyl(0.12, 0.12, 0.4, 0x57534e, 24), { rotation: [0, 0, Math.PI / 2], scale: [1, 1, 0.7] }), -L + 0.25, yUnder + 0.05, -0.35));

  // Rear / all-wheel drive: propeller shaft and rear differential (transverse engine kept for readability)
  const rwd = driven !== 'front';
  if (rwd) {
    if (front) b.add('propshaft', tube([[ex - 0.1, 0.45, gearZ + 0.1], [ex - 0.5, 0.3, 0.05], [axleR + 0.2, wr + 0.02, 0]], 0.028, 0x4b5563));
    b.add('differential', at(tf(cyl(0.12, 0.12, 0.2, 0x52525b, 24), { rotation: [Math.PI / 2, 0, 0] }), axleR, wr + 0.02, 0));
    b.add('differential', at(tf(cyl(0.06, 0.06, 0.1, 0x6b7280, 16), { rotation: [0, 0, Math.PI / 2] }), axleR + 0.15, wr + 0.02, 0));
  }
  // Mid / rear engine: the tank moves to the front (911, Lotus, Ferrari…).
  const tankX = front ? axleR + 0.75 : axleF - 0.2;
  b.add('fuel_tank', at(box(0.6, 0.22, rwd && front ? W * 0.65 : W * 1.3, 0x1e3a8a, 0.06), tankX, 0.33, rwd && front ? W * 0.45 : 0.08));
  b.add('fuel_pump', at(cyl(0.06, 0.06, 0.06, 0xfacc15), tankX, 0.47, 0.25));
  b.add('fuel_filter', at(tf(cyl(0.04, 0.04, 0.14, 0xfde047), { rotation: [0, 0, Math.PI / 2] }), 0.0, 0.26, W - 0.35));
  b.add('fuel_rail', tube([[tankX, 0.42, 0.3], [0.0, 0.26, W - 0.35], [ex - 0.3, 0.5, 0.2]], 0.008, 0x65a30d));
  b.add('evap_canister', at(cyl(0.07, 0.07, 0.2, 0x166534), axleR + 0.2, 0.45, W - 0.25));
  b.add('fuel_cap', at(tf(cyl(0.06, 0.06, 0.02, 0x9ca3af), { rotation: [Math.PI / 2, 0, 0] }), axleR + 0.15, belt - 0.1, -W - 0.005));

  if (spec.fuel === 'hybrid') {
    // Small traction battery under the rear seat + motor-generator in the gearbox + inverter.
    b.add('hv_battery', at(box(0.5, 0.18, W * 1.2, 0x374151, 0.03), front ? axleR + 0.25 : (axleF + axleR) / 2 - 0.1, front ? 0.55 : 0.3, 0));
    b.add('inverter', at(box(0.26, 0.1, 0.3, 0x475569, 0.03), ex - 0.1, ey + 0.38, W - 0.45));
    b.add('drive_motor', at(tf(cyl(0.12, 0.12, 0.14, 0x9ca3af, 24), { rotation: [Math.PI / 2, 0, 0] }), ex - 0.05, 0.6, gearZ + 0.52));
    b.add('hv_cables', tube([[front ? axleR + 0.25 : (axleF + axleR) / 2 - 0.1, front ? 0.55 : 0.3, -0.3], [0, 0.3, -0.4], [ex - 0.1, ey + 0.38, W - 0.45]], 0.016, 0xf97316));
  }
  return b.root;
}

// ---------------------------------------------------------------- motorcycles

export type MotoStyle = 'naked' | 'adventure' | 'sport' | 'cruiser' | 'scooter';

function coil(from: [number, number, number], to: [number, number, number], radius: number, turns: number, color: number) {
  const a = new THREE.Vector3(...from);
  const d = new THREE.Vector3(...to).sub(a);
  const len = d.length();
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= turns * 16; i++) {
    const t = i / (turns * 16);
    const ang = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(ang) * radius, t * len, Math.sin(ang) * radius));
  }
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 24, radius * 0.18, 6, false), mat(color, { metalness: 0.3, roughness: 0.4 }));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.position.copy(a);
  return m;
}

/** Engine layout from the engine description: boxer (BMW GS…), transverse V (Moto Guzzi), longitudinal V (Ducati, Harley…), inline. */
function motoLayout(spec: VehicleSpec): 'boxer' | 'tv' | 'v' | 'inline' {
  const e = `${spec.engine ?? ''}`.toLowerCase();
  if (e.includes('boxer') || e.includes('flat')) return 'boxer';
  if (spec.make === 'Moto Guzzi') return 'tv';
  if (/v-twin|\bv4\b|\bv2\b/.test(e) || ['Ducati', 'Harley-Davidson', 'Indian'].includes(spec.make ?? '')) return 'v';
  return 'inline';
}

function motorcycle(spec: VehicleSpec, style: MotoStyle): THREE.Group {
  const b = builder();
  const paint = paintFor(spec.make ?? '');
  const scooter = style === 'scooter';
  const adv = style === 'adventure';
  const wrF = scooter ? 0.23 : adv ? 0.36 : 0.32;
  const wrR = scooter ? 0.23 : adv ? 0.34 : 0.32;
  const front = scooter ? 0.62 : style === 'cruiser' ? 0.92 : adv ? 0.8 : 0.75;
  const rear = scooter ? -0.6 : style === 'cruiser' ? -0.82 : -0.72;
  const lift = adv ? 0.1 : style === 'cruiser' ? -0.08 : 0;
  const rake = style === 'cruiser' ? 0.32 : scooter ? 0.12 : 0.2;
  const head = { x: front - rake, y: (scooter ? 0.88 : 1.0) + lift };
  const steel = 0x9ca3af;
  const chrome = 0xd4d4d8;

  // Wheels, brakes, sensors
  b.add('wheel_fl', at(wheel(wrF, scooter ? 0.12 : 0.12), front, wrF, 0));
  b.add('wheel_rr', at(wheel(wrR, style === 'cruiser' ? 0.2 : scooter ? 0.13 : 0.17), rear, wrR, 0));
  b.add('brake_fl', at(brakeDisc(wrF * (scooter ? 1.1 : 1)), front, wrF, 0.09));
  if (!scooter) b.add('brake_fl', at(brakeDisc(wrF), front, wrF, -0.09));
  b.root.add(at(brakeDisc(wrR * 0.8), rear, wrR, -0.1));
  b.add('wheel_speed_sensor_fl', at(box(0.03, 0.04, 0.03, 0x10b981, 0.01), front - 0.08, wrF + 0.1, 0.1));
  b.add('wheel_speed_sensor_rr', at(box(0.03, 0.04, 0.03, 0x10b981, 0.01), rear + 0.08, wrR + 0.1, -0.1));

  // Fork, bars, mirrors (decorative)
  for (const z of [0.075, -0.075]) {
    b.root.add(tube([[front, wrF, z], [front - rake * 0.45, wrF + (head.y - wrF) * 0.45, z]], 0.028, adv ? 0xb08d3c : 0x27272a));
    b.root.add(tube([[front - rake * 0.45, wrF + (head.y - wrF) * 0.45, z], [head.x, head.y, z]], 0.02, chrome));
  }
  const barY = style === 'sport' ? head.y - 0.03 : head.y + (style === 'cruiser' ? 0.14 : 0.08);
  const barW = style === 'cruiser' ? 0.42 : style === 'sport' ? 0.27 : adv ? 0.42 : 0.36;
  b.root.add(tube([[head.x - 0.08, barY + 0.02, barW], [head.x, barY, 0.15], [head.x + 0.01, barY - 0.01, 0], [head.x, barY, -0.15], [head.x - 0.08, barY + 0.02, -barW]], 0.013, 0x111827));
  for (const z of [barW - 0.04, -barW + 0.04]) {
    b.root.add(tube([[head.x - 0.05, barY + 0.02, z], [head.x - 0.02, barY + 0.17, z * 1.05]], 0.006, 0x111827));
    b.root.add(at(tf(box(0.02, 0.06, 0.1, 0x111827, 0.01), {}), head.x - 0.02, barY + 0.2, z * 1.08));
  }

  // Frame, swingarm, rear shock
  const pivot: [number, number, number] = [scooter ? -0.2 : -0.22, (scooter ? 0.38 : 0.48) + lift * 0.5, 0];
  if (!scooter) {
    for (const z of [0.09, -0.09]) b.root.add(tube([[head.x, head.y - 0.05, z * 0.3], [0.2, 0.86 + lift, z], [-0.15, 0.72 + lift, z], [pivot[0], pivot[1] + 0.05, z]], 0.024, style === 'naked' ? 0xb91c1c : steel));
    b.root.add(tube([[-0.15, 0.78 + lift, 0], [rear + 0.2, 0.95 + lift, 0]], 0.018, steel));
  } else {
    b.root.add(tube([[head.x, head.y - 0.05, 0], [head.x + 0.05, 0.35, 0], [-0.15, 0.3, 0], [pivot[0], pivot[1], 0]], 0.03, steel));
  }
  for (const z of [0.1, -0.1]) b.root.add(tube([[pivot[0], pivot[1], z], [(pivot[0] + rear) / 2, (pivot[1] + wrR) / 2 + 0.02, z * 1.1], [rear, wrR, z]], 0.022, 0x3f3f46));
  b.root.add(coil([pivot[0] - 0.08, pivot[1] + 0.02, 0.0], [pivot[0] - 0.02, pivot[1] + 0.32, 0.0], 0.035, 7, 0xeab308));

  // Fenders, seat, tail and plate
  const fender = (r: number, x: number, y: number, span: number, w: number) => {
    const g = new THREE.CylinderGeometry(r, r, w, 24, 1, true, Math.PI - span / 2, span);
    g.rotateX(Math.PI / 2);
    return at(new THREE.Mesh(g, mat(adv ? 0xf1f5f9 : 0x111827, { side: THREE.DoubleSide, metalness: 0.2, roughness: 0.5 })), x, y, 0);
  };
  b.root.add(fender(wrF + 0.05, front, wrF, style === 'cruiser' ? 2.2 : 1.4, 0.14));
  b.root.add(fender(wrR + 0.05, rear, wrR, 1.2, 0.2));
  const seatY = style === 'cruiser' ? 0.76 : adv ? 1.0 + lift * 0.2 : scooter ? 0.8 : style === 'sport' ? 0.92 : 0.93;
  b.root.add(at(box(style === 'cruiser' ? 0.38 : 0.55, 0.08, 0.27, 0x111827, 0.04), -0.3, seatY, 0));
  if (style === 'sport') b.root.add(at(box(0.22, 0.07, 0.2, paint, 0.04), -0.6, seatY + 0.08, 0));
  const tailX = rear + (scooter ? 0.05 : 0.18);
  b.root.add(at(box(0.04, 0.04, 0.12, 0x7f1d1d, 0.01), tailX, seatY + 0.02, 0));
  b.root.add(at(tf(box(0.01, 0.1, 0.16, 0xf1f5f9, 0.004), { rotation: [0, 0, 0.3] }), rear + 0.08, wrR + 0.38, 0));

  // Body panels per style (painted, become X-ray when a part is highlighted)
  const panels: Panel[] = [];
  const P = (geo: THREE.BufferGeometry, kind: PanelKind = 'paint', ghost = true) => panels.push({ geo, kind, ghost });
  if (adv) {
    P(place(rbox(0.03, 0.26, 0.26, 0.03), head.x + 0.1, head.y + 0.14, 0, [0, 0, 0.4]), 'glass');
    P(place(new THREE.ConeGeometry(0.11, 0.35, 4), head.x + 0.22, head.y - 0.18, 0, [0, Math.PI / 4, -1.9], [1, 1, 0.6]));
    for (const z of [0.18, -0.18]) {
      P(place(rbox(0.26, 0.2, 0.03, 0.03), 0.22, 0.86 + lift, z, [0, 0, -0.15]));
      P(place(rbox(0.38, 0.32, 0.16, 0.04), rear + 0.3, 0.62 + lift, z * 1.6), 'alu', false);
    }
    b.root.add(tube([[0.38, 0.75 + lift, 0.22], [0.35, 0.45 + lift, 0.27], [0.15, 0.35 + lift, 0.25], [-0.05, 0.55 + lift, 0.2]], 0.012, 0x111827));
    b.root.add(tube([[0.38, 0.75 + lift, -0.22], [0.35, 0.45 + lift, -0.27], [0.15, 0.35 + lift, -0.25], [-0.05, 0.55 + lift, -0.2]], 0.012, 0x111827));
  } else if (style === 'sport') {
    P(place(rbox(0.36, 0.26, 0.3, 0.1), head.x + 0.12, head.y - 0.06, 0, [0, 0, -0.5]));
    P(place(rbox(0.03, 0.16, 0.24, 0.02), head.x + 0.12, head.y + 0.12, 0, [0, 0, 0.7]), 'glass');
    for (const z of [0.15, -0.15]) P(place(rbox(0.6, 0.34, 0.07, 0.035), 0.17, 0.55, z, [0, 0, -0.18]));
    P(place(rbox(0.5, 0.08, 0.3, 0.035), 0.12, 0.33, 0, [0, 0, 0.08]));
    P(place(rbox(0.42, 0.12, 0.2, 0.05), -0.55, seatY - 0.02, 0, [0, 0, 0.2]));
  } else if (scooter) {
    P(place(rbox(0.08, 0.6, 0.42, 0.04), head.x + 0.05, 0.6, 0, [0, 0, -0.2]));
    P(place(rbox(0.6, 0.05, 0.36, 0.02), 0.0, 0.33, 0), 'dark');
    P(place(new THREE.SphereGeometry(1, 28, 16), -0.36, 0.56, 0, [0, 0, -0.12], [0.4, 0.19, 0.16]));
    P(place(rbox(0.04, 0.28, 0.3, 0.03), head.x + 0.1, head.y + 0.2, 0, [0, 0, 0.35]), 'glass');
  } else if (style === 'cruiser') {
    b.root.add(tube([[0.1, 0.38, 0.12], [-0.3, 0.32, 0.2], [-0.85, 0.42, 0.22]], 0.035, chrome));
  }
  if (panels.length) b.root.add(bodyShell(panels, paint));

  // Fuel tank (painted teardrop) and cap
  const tankX = scooter ? -0.35 : style === 'cruiser' ? 0.22 : 0.15;
  const tankY = scooter ? 0.5 : (style === 'cruiser' ? 0.9 : 0.97) + lift;
  const tank = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), mat(paint, { metalness: 0.5, roughness: 0.3 }));
  tank.scale.set(adv ? 0.3 : 0.27, adv ? 0.15 : 0.13, 0.17);
  b.add('fuel_tank', at(tank, tankX, tankY, 0));
  b.add('fuel_cap', at(cyl(0.035, 0.035, 0.02, 0x9ca3af), tankX + 0.05, scooter ? 0.84 : tankY + 0.13, 0));
  addHeadlights(b, head.x + (scooter ? 0.14 : 0.1), head.y - (scooter ? 0.15 : 0.08), [0]);

  const ecuX = rear + 0.32;
  b.add('battery', at(box(0.12, 0.09, 0.1, 0x111827, 0.02), -0.3, seatY - 0.15, 0));
  b.add('ecu', at(box(0.1, 0.03, 0.08, 0x0f766e, 0.01), ecuX, seatY - 0.08, 0));

  // Final drive: chain, toothed belt, shaft + bevel box, scooter variator case, or hub motor
  const drive = spec.finalDrive ?? 'chain';
  const sprF: [number, number] = scooter ? [-0.25, 0.32] : [-0.2, 0.42 + lift * 0.5];
  if (drive === 'chain' || drive === 'belt') {
    const belt = drive === 'belt';
    const w = belt ? 0.03 : 0.015;
    b.add('sprocket_front', at(tf(cyl(0.05, 0.05, w, belt ? 0x52525b : 0xa1a1aa, 16), { rotation: [Math.PI / 2, 0, 0] }), sprF[0], sprF[1], 0.13));
    const rearSpr = at(tf(cyl(0.13, 0.13, w, belt ? 0x52525b : 0xa1a1aa, 32), { rotation: [Math.PI / 2, 0, 0] }), rear, wrR, 0.13);
    rearSpr.userData.spin = 'y';
    b.add('sprocket_rear', rearSpr);
    const chainShape = new THREE.Shape();
    chainShape.absarc(sprF[0], sprF[1], 0.055, Math.PI / 2, -Math.PI / 2, false);
    chainShape.absarc(rear, wrR, 0.135, -Math.PI / 2, Math.PI / 2, false);
    const pts = chainShape.getPoints(60).map((p) => [p.x, p.y, 0.13] as [number, number, number]);
    const loop = tube(pts.filter((_, i) => i % 3 === 0), belt ? 0.013 : 0.009, belt ? 0x111827 : 0x52525b);
    if (belt) loop.scale.z = 1.6;
    b.add(belt ? 'drive_belt' : 'chain', loop);
  } else if (drive === 'shaft') {
    // Drive shaft inside the (left) swingarm, bevel gear housing at the rear hub
    b.add('final_drive', tube([[pivot[0] + 0.02, pivot[1], 0.12], [(pivot[0] + rear) / 2, (pivot[1] + wrR) / 2 + 0.02, 0.13], [rear + 0.05, wrR, 0.13]], 0.032, 0x3f3f46));
    b.add('final_drive', at(tf(cyl(0.085, 0.07, 0.09, 0x6b7280, 24), { rotation: [Math.PI / 2, 0, 0] }), rear, wrR, 0.12));
    b.add('final_drive', at(tf(cyl(0.035, 0.035, 0.1, 0x52525b, 16), { rotation: [0, 0, Math.PI / 2] }), rear + 0.08, wrR, 0.12));
  } else if (drive === 'cvt') {
    // Variator case on the left, from the crankshaft to the rear wheel
    b.add('drive_belt', at(tf(box(0.62, 0.16, 0.07, 0x52525b, 0.06), { rotation: [0, 0, 0.12] }), (sprF[0] + rear) / 2 + 0.02, (sprF[1] + wrR) / 2 + 0.02, 0.15));
  } else if (drive === 'hub') {
    b.add('drive_motor', at(tf(cyl(0.12, 0.12, 0.1, 0x9ca3af, 28), { rotation: [Math.PI / 2, 0, 0] }), rear, wrR, 0));
  }

  if (spec.fuel === 'electric') {
    b.add('hv_battery', at(box(0.42, 0.32, 0.26, 0x374151, 0.04), scooter ? -0.05 : 0.05, scooter ? 0.42 : 0.55, 0));
    if (drive !== 'hub') b.add('drive_motor', at(tf(cyl(0.1, 0.1, 0.16, 0x9ca3af, 24), { rotation: [Math.PI / 2, 0, 0] }), sprF[0] - 0.02, sprF[1], 0));
    b.add('inverter', at(box(0.14, 0.08, 0.16, 0x475569, 0.02), -0.12, scooter ? 0.6 : 0.66, 0));
    b.add('onboard_charger', at(box(0.14, 0.08, 0.14, 0x334155, 0.02), scooter ? -0.45 : 0.2, scooter ? 0.62 : 0.83, 0));
    b.add('hv_cables', tube([[0.05, 0.6, 0.12], [-0.08, 0.62, 0.12], [sprF[0], sprF[1] + 0.06, 0.1]], 0.012, 0xf97316));
    b.add('charge_port', at(cyl(0.035, 0.035, 0.02, 0x111827), tankX + 0.05, scooter ? 0.84 : tankY + 0.13, 0.08));
    return b.root;
  }

  // Engine: crankcase + cylinders laid out like the real engine
  const ox = scooter ? -0.3 : 0.05;
  const oy = scooter ? 0.36 : 0.5 + lift * 0.6;
  const s = scooter ? 0.7 : 1;
  b.add('engine', at(box(0.36 * s, 0.3 * s, 0.26 * s, PALETTE.dark, 0.04), ox, oy, 0));
  const layout = motoLayout(spec);
  const n = Math.max(1, spec.cylinders);
  for (let i = 1; i <= n; i++) {
    if (layout === 'boxer' || layout === 'tv') {
      // Cylinders sticking out on each side (BMW boxer: flat; Moto Guzzi: 45° up)
      const side = i % 2 ? 1 : -1;
      const up = layout === 'tv' ? 0.75 : 0;
      const along = layout === 'boxer' && n > 2 ? (Math.ceil(i / 2) - (n / 2 + 1) / 2) * 0.1 : 0;
      const cylM = cyl(0.06, 0.06, 0.24, 0x94a3b8);
      cylM.rotation.x = side * (Math.PI / 2 - up);
      b.add(`cylinder_${i}`, at(cylM, ox + 0.04 + along, oy + 0.02 + Math.sin(up) * 0.12, side * (0.2 + Math.cos(up) * 0.02)));
      const outZ = side * (0.33 - up * 0.08);
      const outY = oy + 0.02 + Math.sin(up) * 0.2;
      b.add(`spark_plug_${i}`, at(tf(cyl(0.012, 0.012, 0.07, 0xe5e7eb), { rotation: [Math.PI / 2, 0, 0] }), ox + 0.04 + along, outY + 0.04, outZ));
      b.add(`coil_${i}`, at(box(0.05, 0.05, 0.04, 0x111827, 0.01), ox + 0.04 + along, outY + 0.09, outZ));
      b.add(`injector_${i}`, at(cyl(0.01, 0.01, 0.07, 0x84cc16), ox - 0.06 + along, outY + 0.02, side * 0.24));
      b.add('cam_sensor', at(cyl(0.012, 0.012, 0.04, 0x10b981), ox + 0.1, outY, outZ - side * 0.03));
    } else if (layout === 'v') {
      // Longitudinal V: front cylinder leans forward, rear cylinder leans back
      const fwd = i % 2 === 1;
      const ang = fwd ? -0.55 : 0.55;
      const z = n > 2 ? (i > 2 ? -0.06 : 0.06) : 0;
      const c = cyl(0.055 * s, 0.055 * s, 0.24 * s, 0x94a3b8);
      c.rotation.z = ang;
      const cx = ox + (fwd ? 0.1 : -0.08);
      b.add(`cylinder_${i}`, at(c, cx, oy + 0.22 * s, z));
      const tx = cx - Math.sin(ang) * 0.15;
      const ty = oy + 0.22 * s + Math.cos(ang) * 0.15;
      b.add(`spark_plug_${i}`, at(tf(cyl(0.01, 0.01, 0.07, 0xe5e7eb), { rotation: [0, 0, ang] }), tx, ty, z + 0.05));
      b.add(`coil_${i}`, at(box(0.04, 0.05, 0.04, 0x111827, 0.01), tx, ty + 0.04, z + 0.08));
      b.add(`injector_${i}`, at(cyl(0.01, 0.01, 0.07, 0x84cc16), (cx + ox) / 2, oy + 0.32 * s, z - 0.06));
    } else {
      const z = -((n - 1) * 0.1 * s) / 2 + (i - 1) * 0.1 * s;
      const c = cyl(0.05 * s, 0.05 * s, 0.22 * s, 0x94a3b8);
      c.rotation.z = scooter ? -1.3 : -0.2;
      const cx = ox + (scooter ? 0.2 : 0.09);
      const cy = oy + (scooter ? 0.03 : 0.22);
      b.add(`cylinder_${i}`, at(c, cx, cy, z));
      const tx = scooter ? cx + 0.13 : cx + 0.03;
      const ty = scooter ? cy + 0.04 : cy + 0.15;
      b.add(`spark_plug_${i}`, at(cyl(0.01, 0.01, 0.07, 0xe5e7eb), tx, ty, z));
      b.add(`coil_${i}`, at(box(0.04, 0.06, 0.04, 0x111827, 0.01), tx, ty + 0.06, z));
      b.add(`injector_${i}`, at(cyl(0.01, 0.01, 0.07, 0x84cc16), cx - 0.12, cy + 0.08, z));
    }
  }
  b.add('oil_filter', at(cyl(0.04, 0.04, 0.08, 0x2563eb), ox + 0.15 * s, oy - 0.12, 0.12));
  b.add('oil_drain_plug', at(cyl(0.02, 0.02, 0.03, 0xd4d4d8), ox, oy - 0.17 * s, 0));
  b.add('oil_filler_cap', at(cyl(0.025, 0.025, 0.03, PALETTE.yellow), ox - 0.13 * s, oy + 0.12 * s, 0.14));
  b.add('dipstick', at(box(0.04, 0.04, 0.01, 0xfde68a, 0.005), ox - 0.1 * s, oy - 0.08, 0.14));
  b.add('crank_sensor', at(cyl(0.012, 0.012, 0.04, 0x10b981), ox + 0.05, oy - 0.1, 0.14));
  b.add('transmission', at(box(0.2 * s, 0.18 * s, 0.22 * s, 0x52525b, 0.03), ox - 0.23 * s, oy - 0.05, 0));
  b.add('clutch_slave', at(tf(cyl(0.022, 0.022, 0.07, 0xa3e635), { rotation: [0, 0, Math.PI / 2] }), ox - 0.17 * s, oy - 0.03, 0.15));
  b.add('clutch_master', at(box(0.06, 0.04, 0.05, 0x111827, 0.01), head.x - 0.04, barY + 0.03, barW - 0.08));
  b.add('clutch_master', tube([[head.x - 0.04, barY + 0.01, barW - 0.08], [head.x - 0.1, head.y - 0.15, 0.2], [ox, oy + 0.1, 0.16], [ox - 0.17 * s, oy - 0.03, 0.15]], 0.006, 0x111827));
  if (!scooter || n > 1) {
    b.add('radiator', at(box(0.04, 0.25 * s, 0.3 * s, 0x64748b, 0.02), ox + 0.37, oy + 0.12, 0));
    b.add('coolant_reservoir', at(box(0.06, 0.08, 0.06, 0xe0f2fe, 0.02), ox + 0.3, oy - 0.05, -0.14));
    b.add('thermostat', at(cyl(0.025, 0.025, 0.04, 0x06b6d4), ox + 0.25, oy + 0.2, -0.08));
  }
  b.add('air_filter', at(box(0.16, 0.08, 0.2, 0x1f2937, 0.03), scooter ? -0.45 : ox - 0.05, scooter ? 0.62 : oy + 0.38, scooter ? 0.12 : 0));
  b.add('throttle_body', at(cyl(0.03, 0.03, 0.05, 0x9ca3af), ox - 0.09, oy + 0.3 * s, 0.0));
  const exStart: [number, number, number] = layout === 'boxer' ? [ox + 0.12, oy - 0.02, 0.28] : [ox + 0.15, oy + 0.12, 0];
  b.add('exhaust', tube([exStart, [ox + 0.27, oy - 0.2, 0.05], [ox - 0.05, oy - 0.28, 0.14], [rear + 0.32, oy - 0.1, 0.2], [rear + 0.02, oy + 0.05, 0.2]], 0.028, style === 'cruiser' ? chrome : PALETTE.exhaust));
  b.add('exhaust', at(tf(cyl(0.06, 0.07, 0.32, 0x52525b, 20), { rotation: [0, 0, Math.PI / 2 - 0.25] }), rear + 0.12, oy + 0.02, 0.21));
  b.add('catalytic_converter', at(tf(cyl(0.055, 0.055, 0.16, 0xa8a29e), { rotation: [0, 0, Math.PI / 2] }), ox - 0.12, oy - 0.27, 0.14));
  b.add('o2_sensor_upstream', at(cyl(0.012, 0.012, 0.06, 0xf472b6), ox + 0.24, oy - 0.12, 0.08));
  return b.root;
}

// ---------------------------------------------------------------- trucks

function truck(spec: VehicleSpec): THREE.Group {
  const b = builder();
  const wr = 0.52;
  const paint = paintFor(spec.make ?? '');
  // Cab (tilt cab, flat front) and box body
  const cab = new THREE.Shape();
  cab.moveTo(1.0, 0.75);
  cab.lineTo(3.0, 0.75);
  cab.quadraticCurveTo(3.12, 0.8, 3.12, 1.2);
  cab.lineTo(3.06, 3.3);
  cab.quadraticCurveTo(3.0, 3.5, 2.8, 3.52);
  cab.lineTo(1.0, 3.55);
  cab.lineTo(1.0, 0.75);
  const cabGeo = new THREE.ExtrudeGeometry(cab, { depth: 2.2, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 4, curveSegments: 12 });
  cabGeo.translate(0, 0, -1.1);
  const boxGeo = place(rbox(6.3, 2.7, 2.45, 0.06), -2.35, 2.55, 0);
  const panels: Panel[] = [
    { geo: cabGeo, ghost: true },
    { geo: boxGeo, kind: 'plate', ghost: true },
    { geo: place(rbox(0.04, 1.0, 2.0, 0.03), 3.1, 2.65, 0, [0, 0, -0.03]), kind: 'glass' },
    { geo: place(rbox(0.04, 0.55, 1.6, 0.02), 3.15, 1.55, 0), kind: 'dark' },
    { geo: place(rbox(0.2, 0.3, 2.3, 0.04), 3.12, 0.85, 0), kind: 'dark' },
  ];
  for (const z of [1.16, -1.16]) {
    panels.push({ geo: place(rbox(0.9, 0.7, 0.02, 0.02), 2.5, 2.7, z), kind: 'glass' });
    panels.push({ geo: place(rbox(0.06, 0.45, 0.14, 0.02), 3.05, 2.65, z * 1.18), kind: 'dark' });
    panels.push({ geo: place(rbox(0.25, 0.12, 0.12, 0.02), -5.5, 1.1, z * 0.8), kind: 'light' });
  }
  b.root.add(bodyShell(panels, paint));
  b.root.add(at(box(9.0, 0.2, 1.0, 0x374151, 0.03), -1.3, 0.9, 0)); // chassis
  const axles: [string, number][] = [['f', 2.4], ['r', -1.2], ['r2', -2.6]];
  for (const [s, x] of axles) {
    for (const side of [1, -1]) {
      const id = s === 'f' ? (side > 0 ? 'wheel_fl' : 'wheel_fr') : side > 0 ? 'wheel_rl' : 'wheel_rr';
      b.add(id, at(wheel(wr, 0.32, side > 0), x, wr, side * 1.05));
      if (s === 'f') b.add(side > 0 ? 'brake_fl' : 'brake_fr', at(brakeDisc(wr), x, wr, side * 0.85));
      const sensor = s === 'f' ? (side > 0 ? 'fl' : 'fr') : side > 0 ? 'rl' : 'rr';
      b.add(`wheel_speed_sensor_${sensor}`, at(box(0.06, 0.08, 0.06, 0x10b981, 0.01), x - 0.2, wr + 0.2, side * 0.8));
    }
  }
  const ex = 2.2;
  if (spec.fuel === 'electric') {
    // e-trucks: battery packs on the frame rails, central e-axle
    for (const z of [0.85, -0.85]) b.add('hv_battery', at(box(2.2, 0.6, 0.5, 0x374151, 0.05), 0.0, 0.85, z));
    b.add('hv_battery', at(box(1.2, 0.6, 1.0, 0x374151, 0.05), ex, 1.35, 0));
    b.add('drive_motor', at(tf(cyl(0.22, 0.22, 0.5, 0x9ca3af, 28), { rotation: [Math.PI / 2, 0, 0] }), -1.2, wr + 0.05, 0));
    b.add('inverter', at(box(0.5, 0.2, 0.5, 0x475569, 0.03), -0.6, 1.15, 0));
    b.add('hv_cables', tube([[0.0, 0.85, 0.6], [-0.6, 1.15, 0.2], [-1.2, wr + 0.2, 0.1]], 0.03, 0xf97316));
    b.add('onboard_charger', at(box(0.5, 0.2, 0.4, 0x334155, 0.02), 1.3, 1.1, 0.6));
    b.add('charge_port', at(tf(cyl(0.08, 0.08, 0.04, 0x111827, 20), { rotation: [Math.PI / 2, 0, 0] }), 1.6, 1.2, 1.18));
    b.add('dc_dc_converter', at(box(0.3, 0.15, 0.3, 0x0f766e, 0.02), 1.3, 1.1, -0.6));
  } else {
    const eng = engine(b, ex, 1.35, spec.cylinders || 6, 'diesel', 2.2);
    b.add('transmission', at(box(0.8, 0.5, 0.5, 0x52525b, 0.06), ex - 1.3, 1.1, 0));
    b.add('propshaft', tube([[ex - 1.7, 1.0, 0], [-0.2, 0.75, 0], [-1.2, wr + 0.05, 0]], 0.05, 0x4b5563));
    b.add('differential', at(tf(cyl(0.22, 0.22, 0.35, 0x52525b, 24), { rotation: [Math.PI / 2, 0, 0] }), -1.2, wr + 0.05, 0));
    b.add('vehicle_speed_sensor', at(cyl(0.03, 0.03, 0.08, 0x10b981), ex - 1.7, 1.0, 0.2));
    b.add('intercooler', at(box(0.08, 0.7, 1.6, 0x475569, 0.02), 3.0, 1.4, 0));
    b.add('air_filter', at(cyl(0.2, 0.2, 0.7, 0x1f2937), 1.1, 2.6, -1.2));
    b.add('maf_sensor', at(cyl(0.06, 0.06, 0.15, 0xf97316), 1.5, 2.0, -0.8));
    b.add('egr_valve', at(box(0.14, 0.14, 0.14, 0x78716c, 0.02), ex - 0.5, 2.0, -0.4));
    b.add('fuel_tank', at(box(1.4, 0.6, 0.6, 0x9ca3af, 0.2), -0.2, 0.75, 1.0));
    b.add('fuel_cap', at(cyl(0.08, 0.08, 0.03, 0x111827), 0.3, 1.07, 1.0));
    b.add('fuel_pump', at(cyl(0.08, 0.08, 0.12, 0xfacc15), ex - 0.5, 1.1, 0.55));
    b.add('fuel_filter', at(cyl(0.07, 0.07, 0.25, 0xfde047), 0.9, 1.2, 0.75));
    b.add('adblue_tank', at(box(0.5, 0.45, 0.45, 0x38bdf8, 0.08), 0.6, 0.75, -1.0));
    b.add('dpf', at(box(0.9, 0.6, 0.6, 0x57534e, 0.1), -0.6, 0.85, -1.0));
    b.add('dpf_pressure_sensor', at(box(0.08, 0.06, 0.06, 0x10b981, 0.01), -0.6, 1.2, -0.75));
    b.add('nox_sensor', at(box(0.08, 0.06, 0.06, 0x10b981, 0.01), -1.6, 1.2, -0.8));
    b.add('catalytic_converter', at(box(0.5, 0.5, 0.5, 0xa8a29e, 0.1), -1.3, 0.85, -1.0));
    b.add('o2_sensor_upstream', at(cyl(0.02, 0.02, 0.1, 0xf472b6), -0.05, 1.18, -1.0));
    b.add('o2_sensor_downstream', at(cyl(0.02, 0.02, 0.1, 0xf472b6), -1.6, 1.18, -1.0));
    b.add('exhaust', tube([eng.exhaustOut, [ex + 0.4, 0.95, -0.6], [-0.1, 0.85, -1.0]], 0.07, PALETTE.exhaust));
    b.add('exhaust', tube([[-1.55, 0.85, -1.0], [-2.0, 0.75, -0.9]], 0.06, PALETTE.exhaust));
  }
  b.add('radiator', at(box(0.08, 0.8, 1.6, 0x64748b, 0.02), 2.92, 1.45, 0));
  b.add('cooling_fan', at(tf(fan(0.38), { rotation: [0, Math.PI / 2, 0] }), 2.82, 1.45, 0));
  b.add('coolant_reservoir', at(box(0.25, 0.2, 0.3, 0xe0f2fe, 0.04), 2.5, 2.3, 0.7));
  b.add('battery', at(box(0.6, 0.35, 0.5, 0x111827, 0.04), -2.0, 0.8, 1.0));
  b.add('ecu', at(box(0.3, 0.08, 0.25, 0x0f766e, 0.01), ex - 0.4, 1.4, -0.75));
  b.add('abs_module', at(box(0.25, 0.2, 0.2, 0x6b7280, 0.02), 1.3, 1.1, -0.6));
  b.add('cabin', at(box(0.5, 0.35, 2.0, 0x1e293b, 0.05), 2.6, 2.4, 0));
  b.add('cabin_filter', at(box(0.4, 0.05, 0.5, 0xfde68a, 0.01), 2.85, 3.0, 0));
  b.add('brake_fluid_reservoir', at(box(0.12, 0.12, 0.12, 0xfef08a, 0.02), 2.9, 2.1, -0.7));
  b.add('washer_reservoir', at(box(0.2, 0.25, 0.2, 0x60a5fa, 0.03), 2.8, 1.0, 0.85));
  b.add('can_bus', tube([[ex - 0.4, 1.4, -0.75], [2.6, 2.4, -0.5], [1.3, 1.1, -0.6], [-2.0, 1.0, 0.8]], 0.015, 0xf59e0b));
  addHeadlights(b, 3.12, 1.05, [0.9, -0.9]);
  const wiper = box(0.04, 0.03, 0.9, 0x0f172a, 0.01);
  b.add('wiper_blades', at(wiper, 3.14, 2.2, 0.3));
  return b.root;
}

const MOTO_STYLES: MotoStyle[] = ['naked', 'adventure', 'sport', 'cruiser', 'scooter'];

// ---------------------------------------------------------------- agricultural tractor

/** Rim colour by tractor brand (John Deere yellow, others steel grey). */
const RIM_BY_MAKE: Record<string, number> = { 'John Deere': 0xf2c200, Kubota: 0xf26f21, Claas: 0x4b5563, 'Case IH': 0x9ca3af, 'Massey Ferguson': 0x6b7280 };

/** Agricultural tyre: tall sidewall, chevron lugs, pressed-steel rim. Spins around its local Z axis. */
function tractorWheel(r: number, w: number, rimColor: number, outward: boolean) {
  const g = new THREE.Group();
  const rubber = mat(0x17191d, { metalness: 0, roughness: 0.95 });
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.27, 16, 64), rubber);
  tyre.scale.z = w / (r * 0.54);
  g.add(tyre);
  // Chevron lugs: two staggered rows of bars on the tread, angled in a V
  const lugs = Math.round(r * 30);
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    for (const side of [1, -1]) {
      const lug = new THREE.Mesh(new THREE.BoxGeometry(r * 0.07, r * 0.06, w * 0.5), rubber);
      const aa = a + (side > 0 ? 0 : Math.PI / lugs);
      lug.position.set(Math.cos(aa) * r * 0.99, Math.sin(aa) * r * 0.99, side * w * 0.22);
      lug.rotation.set(0, side * 0.55, aa);
      g.add(lug);
    }
  }
  const rimMat = mat(rimColor, { metalness: 0.35, roughness: 0.45 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w * 0.8, 40, 1, true), rimMat);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  const face = outward ? 1 : -1;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.48, r * 0.48, 0.03, 40), rimMat);
  disc.rotation.x = Math.PI / 2;
  disc.position.z = face * w * 0.05;
  g.add(disc);
  // Lightening holes and hub with studs
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.06, r * 0.06, 0.035, 16), mat(0x0b0d10));
    hole.rotation.x = Math.PI / 2;
    hole.position.set(Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32, face * w * 0.05);
    g.add(hole);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.18, w * 0.4, 24), mat(0x3f444d, { metalness: 0.6, roughness: 0.4 }));
  hub.rotation.x = Math.PI / 2;
  hub.position.z = face * w * 0.15;
  g.add(hub);
  g.userData.spin = 'z';
  return g;
}

/** Fender: arched painted sheet over a wheel (axis Z), from angle a0 to a1. */
function fender(r: number, width: number, a0: number, a1: number) {
  const sh = new THREE.Shape();
  sh.absarc(0, 0, r + 0.1, a0, a1, false);
  sh.absarc(0, 0, r + 0.06, a1, a0, true);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 32 });
  geo.translate(0, 0, -width / 2);
  return geo;
}

function tractor(spec: VehicleSpec): THREE.Group {
  const b = builder();
  const paint = paintFor(spec.make ?? '');
  const rim = RIM_BY_MAKE[spec.make ?? ''] ?? 0x8a8f96;
  const rR = 0.92, rF = 0.6; // rear / front wheel radius (≈ 1.85 m and 1.2 m tyres)
  const xR = -0.95, xF = 1.6; // rear / front axle
  const zR = 0.88, zF = 0.82; // half track
  const big = (spec.cylinders ?? 6) >= 6;

  // ---- Wheels, fenders, axles
  for (const side of [1, -1] as const) {
    const sfx = side > 0 ? 'l' : 'r';
    b.add(`wheel_r${sfx}`, at(tractorWheel(rR, 0.6, rim, true), xR, rR, side * zR));
    b.add(`wheel_f${sfx}`, at(tractorWheel(rF, 0.42, rim, true), xF, rF, side * zF));
    b.add(`brake_r${sfx}`, at(tf(cyl(0.22, 0.22, 0.12, 0x52525b, 24), { rotation: [Math.PI / 2, 0, 0] }), xR, rR, side * 0.42)); // wet brake housing
    b.add(`wheel_speed_sensor_r${sfx}`, at(box(0.05, 0.07, 0.05, 0x10b981, 0.01), xR + 0.18, rR + 0.15, side * 0.4));
  }
  b.add('differential', at(tf(cyl(0.16, 0.2, 1.0, 0x3f444d, 24), { rotation: [Math.PI / 2, 0, 0] }), xR, rR, 0)); // rear axle trumpets
  b.add('differential', at(new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.6, 0.55, 3, 0.08), mat(0x3a3f47, { metalness: 0.5, roughness: 0.5 })), xR, rR, 0));
  b.add('differential', at(new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.26, 1.2, 3, 0.06), mat(0x3a3f47, { metalness: 0.5, roughness: 0.5 })), xF, rF, 0)); // front axle beam
  b.add('propshaft', tube([[xR + 0.35, 0.55, 0.08], [0.4, 0.5, 0.1], [xF - 0.15, rF, 0.05]], 0.045, 0x4b5563));
  // Transmission housing (gearbox + rear axle centre), between engine and rear axle
  b.add('transmission', at(new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.62, 0.62, 3, 0.1), mat(0x3a3f47, { metalness: 0.5, roughness: 0.5 })), -0.35, 0.95, 0));
  b.add('vehicle_speed_sensor', at(cyl(0.025, 0.025, 0.08, 0x10b981), -0.1, 1.29, 0.2));
  // Rear linkage (3-point hitch) and PTO
  for (const z of [0.36, -0.36]) {
    b.add('transmission', tube([[xR - 0.2, 0.62, z * 0.6], [-1.95, 0.48, z]], 0.035, 0x52525b)); // lower links
    b.add('transmission', tube([[xR - 0.1, 1.55, z * 0.8], [-1.55, 1.5, z * 0.85], [-1.6, 0.9, z]], 0.03, 0x52525b)); // lift arms + rods
    b.add('transmission', at(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.015, 8, 16), mat(0x9ca3af)), -1.97, 0.48, z));
  }
  b.add('transmission', tube([[xR - 0.25, 1.15, 0], [-1.9, 1.05, 0]], 0.04, 0xd4d4d8)); // top link
  b.add('transmission', at(tf(cyl(0.045, 0.045, 0.16, 0x9ca3af, 12), { rotation: [0, 0, Math.PI / 2] }), -1.42, 0.72, 0)); // PTO stub
  b.add('transmission', at(tf(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 20, 1, true, 0, Math.PI), mat(paint)), { rotation: [0, 0, Math.PI / 2] }), -1.42, 0.74, 0)); // PTO guard

  // ---- Engine (longitudinal: crankshaft along X, accessory belt at the front)
  const s = big ? 1.4 : 1.2;
  const ex = 0.78, ey = 1.08;
  const longi = (id: string, obj: THREE.Object3D) => {
    const g = new THREE.Group();
    g.add(obj);
    g.position.set(ex, ey, 0);
    g.rotation.y = -Math.PI / 2;
    return b.add(id, g);
  };
  const eng = engine({ root: b.root, add: longi }, 0, 0, spec.cylinders || 6, 'diesel', s, { turbo: true });
  // exhaust outlet (engine-local x → world z, local z → world -x)
  const [lx, ly, lz] = eng.exhaustOut;
  const out: [number, number, number] = [ex - lz, ey + ly, lx];

  // ---- Bonnet, grille, front weights
  const hood = new THREE.Shape();
  hood.moveTo(0.02, 0.0);
  hood.lineTo(2.18, 0.0);
  hood.lineTo(2.2, 0.62);
  hood.quadraticCurveTo(2.18, 0.86, 1.95, 0.9);
  hood.lineTo(0.02, 0.98);
  hood.lineTo(0.02, 0.0);
  const hoodGeo = new THREE.ExtrudeGeometry(hood, { depth: 0.96, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 4, curveSegments: 16 });
  hoodGeo.translate(0, 0.98, -0.48);
  const panels: Panel[] = [{ geo: hoodGeo, ghost: true }];
  panels.push({ geo: place(rbox(0.05, 0.62, 0.86, 0.03), 2.27, 1.33, 0), kind: 'dark' }); // grille
  for (let i = 0; i < 6; i++) panels.push({ geo: place(rbox(0.02, 0.025, 0.82, 0.008), 2.3, 1.08 + i * 0.1, 0), kind: 'trim' });
  for (const z of [0.3, -0.3]) panels.push({ geo: place(rbox(0.04, 0.1, 0.18, 0.03), 2.29, 1.7, z), kind: 'lamp' });
  panels.push({ geo: place(rbox(0.32, 0.5, 0.8, 0.05), 2.45, 0.78, 0), kind: 'dark' }); // front weight block
  // Fenders
  for (const side of [1, -1]) {
    panels.push({ geo: place(fender(rR, 0.66, 0.15, Math.PI - 0.05), xR, rR, side * zR) });
    panels.push({ geo: place(fender(rF, 0.46, 0.35, Math.PI - 0.35), xF, rF, side * zF) });
  }
  // ---- Cab: corner posts, large glass, roof
  const cx0 = -1.42, cx1 = 0.02, cy0 = 1.62, cy1 = 2.95, cz = 0.62;
  for (const [x, z] of [[cx0, cz], [cx0, -cz], [cx1, cz], [cx1, -cz]] as [number, number][]) panels.push({ geo: place(rbox(0.06, cy1 - cy0, 0.06, 0.02), x, (cy0 + cy1) / 2, z), kind: 'dark' });
  panels.push({ geo: place(rbox(cx1 - cx0 - 0.02, cy1 - cy0 - 0.06, 2 * cz - 0.02, 0.02), (cx0 + cx1) / 2, (cy0 + cy1) / 2, 0), kind: 'glass', ghost: true });
  panels.push({ geo: place(rbox(cx1 - cx0 + 0.3, 0.14, 2 * cz + 0.22, 0.06), (cx0 + cx1) / 2 - 0.02, cy1 + 0.07, 0), ghost: true }); // roof
  panels.push({ geo: place(rbox(cx1 - cx0 + 0.02, 0.1, 2 * cz + 0.02, 0.02), (cx0 + cx1) / 2, cy0, 0), kind: 'dark' }); // cab floor
  for (const side of [1, -1]) {
    panels.push({ geo: place(rbox(0.04, 0.35, 0.03, 0.01), cx1 + 0.05, 2.35, side * (cz + 0.35)), kind: 'dark' }); // mirror arm + head
    panels.push({ geo: place(rbox(0.05, 0.28, 0.18, 0.02), cx1 + 0.08, 2.45, side * (cz + 0.5)), kind: 'glass' });
    panels.push({ geo: place(rbox(0.45, 0.04, 0.28, 0.01), (cx0 + cx1) / 2 + 0.2, 0.78 + (side > 0 ? 0.32 : 0), side * (cz + 0.05)), kind: 'alu' }); // steps
  }
  for (const z of [0.45, 0.15, -0.15, -0.45]) panels.push({ geo: place(rbox(0.05, 0.08, 0.14, 0.02), cx1 + 0.17, cy1 + 0.05, z), kind: 'lamp' }); // work lights
  b.root.add(bodyShell(panels, paint));
  b.add('headlights', at(box(0.05, 0.1, 0.18, 0xfef9c3, 0.03), 2.3, 1.7, 0.3));
  b.add('headlights', at(box(0.05, 0.1, 0.18, 0xfef9c3, 0.03), 2.3, 1.7, -0.3));

  // Cab interior, controls, electronics
  b.add('cabin', at(box(0.5, 0.12, 0.5, 0x1e293b, 0.05), -0.75, 1.95, 0)); // seat
  b.add('cabin', at(tf(box(0.1, 0.6, 0.5, 0x1e293b, 0.05), { rotation: [0, 0, 0.15] }), -1.02, 2.3, 0));
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 10, 32), mat(0x111827, { roughness: 0.7 }));
  sw.rotation.set(0, Math.PI / 2, 0.6);
  b.add('steering_angle', at(sw, -0.2, 2.25, 0));
  b.add('cabin', at(box(0.3, 0.12, 0.2, 0x111827, 0.03), -0.65, 2.15, -0.45)); // armrest terminal
  b.add('ecu', at(box(0.25, 0.06, 0.2, 0x0f766e, 0.01), -0.6, 1.75, 0.45));
  b.add('cabin_filter', at(box(0.35, 0.04, 0.45, 0xfde68a, 0.01), -0.7, cy1 + 0.02, 0));
  b.add('can_bus', tube([[-0.6, 1.75, 0.45], [-0.2, 1.4, 0.3], [ex, ey + 0.3, 0.3], [2.0, 1.4, 0.2]], 0.012, 0xf59e0b));
  b.add('can_bus', tube([[-0.6, 1.75, 0.45], [-1.3, 1.5, 0.4], [-1.5, 1.2, 0.3]], 0.012, 0xf59e0b)); // to the ISOBUS rear socket
  b.add('can_bus', at(tf(cyl(0.05, 0.05, 0.06, 0x111827, 16), { rotation: [0, 0, Math.PI / 2] }), -1.52, 1.2, 0.3));

  // ---- Cooling, intake, fuel, exhaust after-treatment
  b.add('radiator', at(box(0.08, 0.6, 0.7, 0x64748b, 0.02), 2.05, 1.32, 0));
  b.add('cooling_fan', at(tf(fan(0.28), { rotation: [0, Math.PI / 2, 0] }), 1.93, 1.32, 0));
  b.add('intercooler', at(box(0.06, 0.5, 0.65, 0x475569, 0.02), 2.14, 1.32, 0));
  b.add('coolant_reservoir', at(box(0.2, 0.15, 0.2, 0xe0f2fe, 0.03), 1.75, 1.75, -0.22));
  b.add('air_filter', at(tf(cyl(0.14, 0.14, 0.55, 0x1f2937, 24), { rotation: [0, 0, Math.PI / 2] }), 1.55, 1.72, 0.2));
  b.add('maf_sensor', at(tf(cyl(0.05, 0.05, 0.1, 0xf97316), { rotation: [0, 0, Math.PI / 2] }), 1.2, 1.72, 0.2));
  b.add('vacuum_hoses', tube([[1.25, 1.72, 0.2], [1.0, 1.65, 0.3], [ex + 0.05, ey + 0.1, 0.38]], 0.06, 0x111827));
  b.add('fuel_tank', at(new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.55, 0.42, 3, 0.12), mat(0x1f2937, { roughness: 0.6 })), -0.45, 1.1, 0.62));
  b.add('fuel_cap', at(cyl(0.07, 0.07, 0.03, 0x111827), -0.2, 1.39, 0.62));
  b.add('fuel_filter', at(cyl(0.05, 0.05, 0.18, 0xfde047), 0.25, 0.95, 0.42));
  b.add('fuel_pump', at(cyl(0.05, 0.05, 0.08, 0xfacc15), -0.45, 1.4, 0.75));
  b.add('fuel_rail', tube([[-0.45, 1.3, 0.62], [0.25, 0.95, 0.42], [ex, ey + 0.3, -0.3]], 0.01, 0x65a30d));
  b.add('adblue_tank', at(box(0.3, 0.35, 0.3, 0x38bdf8, 0.05), -0.45, 1.05, -0.62));
  b.add('battery', at(box(0.35, 0.25, 0.22, 0x111827, 0.02), 0.25, 0.85, -0.5));
  b.add('starter', at(tf(cyl(0.07, 0.07, 0.24, 0x6b7280), { rotation: [0, 0, Math.PI / 2] }), 0.1, 0.9, -0.3));
  // Turbo → after-treatment box (DOC + DPF + SCR) → vertical stack in front of the cab pillar
  b.add('exhaust', tube([out, [out[0] - 0.25, out[1] + 0.15, out[2] + 0.02], [0.1, 1.6, 0.5], [0.15, 1.75, 0.5]], 0.06, PALETTE.exhaust));
  b.add('dpf', at(cyl(0.18, 0.18, 0.7, 0xb4b9c2, 28), 0.15, 2.05, 0.5));
  b.add('catalytic_converter', at(cyl(0.12, 0.12, 0.2, 0xa8a29e, 24), 0.15, 1.65, 0.5));
  b.add('dpf_pressure_sensor', at(box(0.07, 0.05, 0.05, 0x10b981, 0.01), 0.35, 2.05, 0.5));
  b.add('nox_sensor', at(box(0.07, 0.05, 0.05, 0x10b981, 0.01), 0.15, 2.48, 0.68));
  b.add('egt_sensor', at(cyl(0.014, 0.014, 0.1, 0xf472b6), 0.3, 1.8, 0.5));
  b.add('exhaust', tube([[0.15, 2.4, 0.5], [0.15, 3.2, 0.5]], 0.06, 0x8a8f98));
  b.add('exhaust', at(tf(cyl(0.065, 0.065, 0.04, 0x52525b, 16), { rotation: [0.6, 0, 0] }), 0.15, 3.22, 0.5));
  return b.root;
}

export function buildVehicle(spec: VehicleSpec): THREE.Group {
  const n = Math.min(Math.max(spec.cylinders || 4, 1), 12);
  const s = { ...spec, cylinders: n };
  switch (spec.type) {
    case 'motorcycle': {
      const st = MOTO_STYLES.includes(spec.body as MotoStyle) ? (spec.body as MotoStyle) : 'naked';
      return motorcycle({ ...s, cylinders: spec.cylinders || (spec.fuel === 'electric' ? 0 : 2) }, st);
    }
    case 'truck':
      return truck({ ...s, cylinders: spec.cylinders || 6 });
    case 'tractor':
      return tractor({ ...s, cylinders: Math.min(spec.cylinders || 6, 6) });
    case 'van':
      return carLike(s, 'van');
    default:
      return carLike(s, spec.body && spec.body in CAR_STYLES ? (spec.body as CarStyle) : 'hatch');
  }
}
