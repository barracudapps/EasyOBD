import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildVehicle, type VehicleSpec } from './vehicles';

export const SEVERITY_COLORS: Record<string, number> = {
  low: 0x22c55e,
  medium: 0xf59e0b,
  high: 0xf97316,
  critical: 0xef4444,
  info: 0x22d3ee,
};

type MatState = { color: THREE.Color; emissive: THREE.Color; emissiveIntensity: number; opacity: number; transparent: boolean };

export class VehicleScene {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private model: THREE.Group | null = null;
  private components = new Map<string, THREE.Object3D>();
  private highlighted = new Set<string>();
  private labelObjects: CSS2DObject[] = [];
  private color = new THREE.Color(SEVERITY_COLORS.high);
  private raf = 0;
  private clock = new THREE.Clock();
  private time = 0;
  private resizeObs: ResizeObserver;
  private focusTarget: { target: THREE.Vector3; pos: THREE.Vector3 } | null = null;
  private down = { x: 0, y: 0 };
  private nameOf: (id: string) => string = (id) => id;
  onPick: ((id: string | null) => void) | null = null;
  /** Transparent body (X-ray). Off = painted body, shown when nothing is highlighted. */
  xray = false;
  /** Exploded view: 0 = assembled, 1 = parts pulled apart. */
  private explode = 0;
  private explodeTarget = 0;
  private explodeOffsets = new Map<THREE.Object3D, THREE.Vector3>();
  private spinning: THREE.Object3D[] = [];
  /** Reciprocating parts (pistons) of the highlighted components. */
  private stroking: THREE.Object3D[] = [];
  private contact: THREE.Mesh;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    // Studio reflections for paint, glass and metal.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'scene-labels';
    container.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    this.camera.position.set(4.5, 2.6, 4.8);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.6;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
      this.focusTarget = null;
    });

    this.scene.add(new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(4, 8, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0005;
    key.shadow.radius = 6;
    this.scene.add(key);
    const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.35 }));
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = 0.001;
    shadowFloor.receiveShadow = true;
    this.scene.add(shadowFloor);
    // Cool rim light (kept desaturated so it does not tint the paint) + soft front fill.
    const rim = new THREE.DirectionalLight(0xc7d2fe, 1.0);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xfff7ed, 0.45);
    fill.position.set(3, 1.2, -5);
    this.scene.add(fill);
    // Contact shadow: soft dark blob right under the vehicle (ambient occlusion with the ground).
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.75 }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = 0.003;
    this.contact.renderOrder = -1;
    this.scene.add(this.contact);

    // Floor: concentric glow + grid
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(9, 64),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.05, depthWrite: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const grid = new THREE.PolarGridHelper(9, 16, 8, 64, 0x334155, 0x1e293b);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(grid);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5) this.pick(e);
    });

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  setNameResolver(fn: (id: string) => string) {
    this.nameOf = fn;
  }

  setVehicle(spec: VehicleSpec) {
    if (this.model) {
      this.scene.remove(this.model);
      this.model.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
    }
    this.model = buildVehicle(spec);
    this.components.clear();
    this.model.traverse((o) => {
      if (o.userData.componentId && o.name === o.userData.componentId) this.components.set(o.name, o);
      if (o instanceof THREE.Mesh && !o.userData.shell) o.castShadow = true;
      if (o instanceof THREE.Mesh && o.userData.shell && o.parent?.userData.solidShell) o.castShadow = true;
      if (o instanceof THREE.Mesh && !o.userData.shell) {
        const m = o.material as THREE.MeshStandardMaterial;
        o.material = m.clone();
        const c = o.material as THREE.MeshStandardMaterial;
        o.userData.orig = {
          color: c.color?.clone(),
          emissive: c.emissive?.clone() ?? new THREE.Color(0),
          emissiveIntensity: c.emissiveIntensity ?? 0,
          opacity: c.opacity,
          transparent: c.transparent,
        } satisfies MatState;
      }
    });
    this.scene.add(this.model);
    const bb = new THREE.Box3().setFromObject(this.model);
    const size = bb.getSize(new THREE.Vector3());
    const centre = bb.getCenter(new THREE.Vector3());
    this.contact.scale.set(size.x * 1.15, size.z * 1.35, 1);
    this.contact.position.set(centre.x, 0.003, centre.z);
    this.computeExplode();
    this.applyXray();
    this.fit();
    const ids = [...this.highlighted];
    this.highlighted.clear();
    this.highlight(ids);
  }

  has(id: string) {
    return this.components.has(id);
  }

  setXray(on: boolean) {
    this.xray = on;
    this.applyXray();
  }

  /** Pulls every component group away from the vehicle centre (animated). */
  setExploded(on: boolean) {
    this.explodeTarget = on ? 1 : 0;
    this.applyXray();
    this.controls.autoRotate = false;
    if (!this.highlighted.size) this.fit(on ? 1.35 : 1);
  }

  private computeExplode() {
    this.explodeOffsets.clear();
    if (!this.model) return;
    const all = new THREE.Box3();
    for (const g of this.components.values()) all.expandByObject(g);
    const center = all.getCenter(new THREE.Vector3());
    const size = all.getSize(new THREE.Vector3());
    const k = Math.max(size.x, size.z) * 0.32;
    for (const g of this.components.values()) {
      const c = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3()).sub(center);
      // Spread mostly sideways and upwards; length is compressed so the view stays compact.
      const off = new THREE.Vector3((c.x / (size.x / 2 || 1)) * 0.6, 0.35 + Math.max(0, c.y / (size.y || 1)) * 1.4, (c.z / (size.z / 2 || 1)) * 1.1);
      this.explodeOffsets.set(g, off.multiplyScalar(k));
    }
    for (const g of this.components.values()) g.position.copy(this.explodeOffsets.get(g)!).multiplyScalar(this.explode);
  }

  /** Painted body when idle; ghost body in X-ray mode or when parts are highlighted. */
  private applyXray() {
    const solid = !this.xray && this.highlighted.size === 0 && this.explodeTarget === 0;
    this.model?.traverse((o) => {
      if (o.userData.isShell) o.visible = !solid;
      if (o.userData.solidShell) o.visible = solid;
    });
  }

  private fit(zoom = 1) {
    if (!this.model) return;
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (zoom > 1) center.y += size.y * 0.25;
    const radius = Math.max(size.x, size.y, size.z) * 0.62 * zoom;
    const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360);
    this.focusTarget = {
      target: center,
      pos: center.clone().add(new THREE.Vector3(0.75, 0.42, 0.85).normalize().multiplyScalar(dist)),
    };
    this.controls.minDistance = radius * 0.3;
    this.controls.maxDistance = dist * 2.5;
  }

  /** Highlights components (unknown ids are ignored, `engine` used as fallback) and focuses on them. */
  highlight(ids: string[], severity: string = 'high') {
    this.color.setHex(SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.high);
    let wanted = ids.filter((id) => this.components.has(id));
    if (ids.length && !wanted.length && this.components.has('engine')) wanted = ['engine'];
    this.highlighted = new Set(wanted);
    const any = this.highlighted.size > 0;
    // Rotating parts of the highlighted components (wheels, discs, fan, pulleys, sprockets) turn slowly.
    this.spinning = [];
    for (const o of this.stroking) o.position.y = o.userData.baseY;
    this.stroking = [];
    for (const id of this.highlighted) {
      this.components.get(id)?.traverse((o) => {
        if (o.userData.spin) this.spinning.push(o);
        if (o.userData.stroke) {
          o.userData.baseY ??= o.position.y;
          this.stroking.push(o);
        }
      });
    }

    this.labelObjects.forEach((l) => l.removeFromParent());
    this.labelObjects = [];

    this.applyXray();
    // Dim every mesh of the model that is not highlighted (including decorative parts).
    this.model?.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.shell) return;
      const on = this.highlighted.has(o.userData.componentId);
      const m = o.material as THREE.MeshStandardMaterial;
      const orig = o.userData.orig as MatState | undefined;
      if (!orig) return;
      const transparent = on ? orig.transparent : any ? true : orig.transparent;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = on ? Math.max(orig.opacity, 0.95) : any ? Math.min(orig.opacity, 0.16) : orig.opacity;
      o.renderOrder = on ? 2 : 0;
      m.depthWrite = on || !any;
      if (!on) {
        m.emissive?.copy(orig.emissive);
        m.emissiveIntensity = orig.emissiveIntensity;
      }
    });
    // One label per family (coil_1..coil_4 → "Bobine d'allumage ×4") to avoid overlapping tags.
    const families = new Map<string, string[]>();
    for (const id of this.highlighted) {
      const base = id.replace(/_\d+$/, '');
      families.set(base, [...(families.get(base) ?? []), id]);
    }
    for (const ids of families.values()) {
      const obj = this.components.get(ids[0])!;
      const div = document.createElement('div');
      div.className = 'scene-label';
      const name = this.nameOf(ids[0]);
      div.textContent = ids.length > 1 ? `${name.replace(/\s*[–-]\s*cylindre \d+$/i, '').replace(/ \d+$/, '')} ×${ids.length}` : name;
      div.style.setProperty('--c', '#' + this.color.getHexString());
      const label = new CSS2DObject(div);
      const box = new THREE.Box3();
      ids.forEach((i) => box.expandByObject(this.components.get(i)!));
      const c = box.getCenter(new THREE.Vector3());
      label.position.copy(obj.worldToLocal(new THREE.Vector3(c.x, box.max.y + 0.08, c.z)));
      obj.add(label);
      this.labelObjects.push(label);
    }
    // Spread labels a little when several overlap: hide labels beyond 6.
    this.labelObjects.forEach((l, i) => (l.visible = i < 6));

    if (any) {
      this.controls.autoRotate = false;
      const box = new THREE.Box3();
      this.highlighted.forEach((id) => box.expandByObject(this.components.get(id)!));
      const center = box.getCenter(new THREE.Vector3());
      this.focusBox(box);
    } else {
      this.fit(this.explodeTarget ? 1.35 : 1);
      this.controls.autoRotate = this.explodeTarget === 0;
    }
  }

  /** Moves the camera close to a box (small parts get a close-up, big assemblies stay framed). */
  private focusBox(box: THREE.Box3, from?: THREE.Vector3) {
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 0.12);
    const dir = from ? from.clone() : this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.y < 0.25) dir.y = 0.35;
    dir.normalize();
    this.controls.minDistance = 0.08;
    this.focusTarget = { target: center, pos: center.clone().add(dir.multiplyScalar(size * 2.4 + 0.45)) };
  }

  /** Close-up on the engine bay (body made transparent): to look around before working on a part. */
  focusEngine() {
    const ids = ['engine', 'drive_motor'].filter((id) => this.components.has(id));
    if (!ids.length) return false;
    this.controls.autoRotate = false;
    const box = new THREE.Box3();
    ids.forEach((id) => box.expandByObject(this.components.get(id)!));
    // From above, on the timing / accessory-belt side: belt, alternator, coils and sensors in view.
    this.focusBox(box, new THREE.Vector3(0.35, 0.85, -0.55));
    return true;
  }

  resetView() {
    this.highlight([]);
  }

  private pick(e: PointerEvent) {
    if (!this.model || !this.onPick) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObject(this.model, true).filter((h) => h.object.userData.componentId && (h.object as THREE.Mesh).isMesh);
    // Prefer opaque (non dimmed) hits.
    const hit = hits.find((h) => ((h.object as THREE.Mesh).material as THREE.Material).opacity > 0.5) ?? hits[0];
    this.onPick(hit ? (hit.object.userData.componentId as string) : null);
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    const t = this.time;
    if (this.focusTarget) {
      const k = 1 - Math.pow(0.002, dt || 0.016);
      this.controls.target.lerp(this.focusTarget.target, k);
      this.camera.position.lerp(this.focusTarget.pos, k);
      if (this.camera.position.distanceTo(this.focusTarget.pos) < 0.01) this.focusTarget = null;
    }
    if (this.explode !== this.explodeTarget) {
      const step = dt * 2.2;
      this.explode = this.explode < this.explodeTarget ? Math.min(this.explodeTarget, this.explode + step) : Math.max(this.explodeTarget, this.explode - step);
      const e = this.explode * this.explode * (3 - 2 * this.explode); // smoothstep
      for (const [g, off] of this.explodeOffsets) g.position.copy(off).multiplyScalar(e);
    }
    for (const o of this.spinning) {
      const axis = o.userData.spin as 'x' | 'y' | 'z';
      o.rotation[axis] += dt * 2.5;
    }
    for (const o of this.stroking) {
      const { amp, phase } = o.userData.stroke as { amp: number; phase: number };
      o.position.y = o.userData.baseY + amp * Math.cos(t * 2.5 + phase);
    }
    if (this.highlighted.size) {
      const pulse = 0.55 + 0.45 * Math.sin(t * 4);
      for (const id of this.highlighted) {
        this.components.get(id)?.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const m = o.material as THREE.MeshStandardMaterial;
            m.emissive?.copy(this.color);
            m.emissiveIntensity = 0.4 + pulse * 1.2;
          }
        });
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}
