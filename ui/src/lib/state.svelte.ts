// Global application state (Svelte 5 runes). Persisted bits use localStorage defensively.
import { call } from './api';
import type { ConnectResult, DtcItem, KbInfo, VehicleProfile, VehicleType } from './types';

/** A vehicle saved in the user's garage (all work is attached to it). */
export interface GarageVehicle {
  id: string;
  name: string;
  profile: VehicleProfile;
  plate?: string;
  vin?: string;
  mileage?: number;
  notes?: string;
  created: number;
}
export type JournalKind = 'diagnostic' | 'maintenance' | 'repair' | 'inspection' | 'note';
export interface JournalEntry {
  id: string;
  vehicleId: string;
  date: number;
  kind: JournalKind;
  title: string;
  details?: string;
  codes?: string[];
  mileage?: number;
  cost?: number;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

export type View = 'home' | 'garage' | 'diagnostic' | 'eye' | 'audio' | 'maintenance' | 'inspection' | 'training' | 'codes' | 'expert';

export const app = $state({
  view: load<View>('easyobd.view', 'home'),
  theme: load<'dark' | 'light'>('easyobd.theme', 'dark'),
  kb: null as KbInfo | null,
  vehicleTypes: [] as VehicleType[],
  profiles: [] as VehicleProfile[],
  maintenanceDisclaimer: '',
  profile: load<VehicleProfile | null>('easyobd.profile', null),
  garage: load<GarageVehicle[]>('easyobd.garage', []),
  vehicleId: load<string | null>('easyobd.vehicleId', null),
  journal: load<JournalEntry[]>('easyobd.journal', []),
  /** True while a training scenario borrows a vehicle profile (garage untouched). */
  temporaryProfile: false,
  connection: null as ConnectResult | null,
  dtcs: [] as DtcItem[],
  /** Components highlighted in the shared 3D viewer, with their severity. */
  highlight: [] as string[],
  highlightSeverity: 'high' as 'low' | 'medium' | 'high' | 'critical' | 'info',
  toast: null as { text: string; kind: 'info' | 'error' | 'ok' } | null,
  expertUnlocked: false,
  pickerOpen: false,
  /** Answers given in the "à l'œil" questionnaire + evidence from audio, shared between views. */
  audioEvidence: [] as { hypothesis: string; weight: number; label: string }[],
});

export function go(view: View) {
  app.view = view;
  save('easyobd.view', view);
  window.scrollTo({ top: 0 });
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
function persistGarage() {
  save('easyobd.garage', app.garage);
  save('easyobd.vehicleId', app.vehicleId);
}

export function currentVehicle(): GarageVehicle | null {
  return app.garage.find((v) => v.id === app.vehicleId) ?? null;
}

/** Storage key scope for per-vehicle work (checklists, photos, VIN place…). */
export function vkey(): string {
  if (app.temporaryProfile) return `tmp.${app.profile?.id ?? 'any'}`;
  return app.vehicleId ?? app.profile?.id ?? 'any';
}

export function addVehicle(profile: VehicleProfile, name?: string): GarageVehicle {
  const v: GarageVehicle = { id: uid(), name: name || `${profile.make} ${profile.model}`, profile, created: Date.now() };
  app.garage = [...app.garage, v];
  selectVehicle(v.id);
  return v;
}

export function selectVehicle(id: string | null) {
  app.vehicleId = id;
  app.temporaryProfile = false;
  const v = currentVehicle();
  app.profile = v?.profile ?? null;
  save('easyobd.profile', app.profile);
  persistGarage();
}

export function updateVehicle(id: string, patch: Partial<GarageVehicle>) {
  app.garage = app.garage.map((v) => (v.id === id ? { ...v, ...patch } : v));
  if (id === app.vehicleId && patch.profile) {
    app.profile = patch.profile;
    save('easyobd.profile', app.profile);
  }
  persistGarage();
}

export function deleteVehicle(id: string) {
  app.garage = app.garage.filter((v) => v.id !== id);
  app.journal = app.journal.filter((j) => j.vehicleId !== id);
  save('easyobd.journal', app.journal);
  if (app.vehicleId === id) selectVehicle(app.garage[0]?.id ?? null);
  persistGarage();
}

/** Picking a model: updates the current garage vehicle, or creates the first one. */
export function setProfile(p: VehicleProfile | null, opts: { temporary?: boolean; asNew?: boolean } = {}) {
  if (opts.temporary) {
    app.profile = p;
    app.temporaryProfile = true;
    return;
  }
  if (!p) {
    selectVehicle(null);
    return;
  }
  const cur = currentVehicle();
  if (cur && !opts.asNew) {
    const renamed = cur.name === `${cur.profile.make} ${cur.profile.model}` ? `${p.make} ${p.model}` : cur.name;
    updateVehicle(cur.id, { profile: p, name: renamed });
    app.temporaryProfile = false;
  } else {
    addVehicle(p);
  }
}

export function addJournal(e: Omit<JournalEntry, 'id' | 'vehicleId' | 'date'> & { date?: number }) {
  const v = currentVehicle();
  if (!v || app.temporaryProfile) return;
  const last = app.journal.filter((j) => j.vehicleId === v.id).at(-1);
  // Avoid duplicates (same diagnostic re-read the same day)
  if (last && last.kind === e.kind && last.title === e.title && (e.codes ?? []).join() === (last.codes ?? []).join() && Date.now() - last.date < 6 * 3600e3) return;
  app.journal = [...app.journal, { id: uid(), vehicleId: v.id, date: e.date ?? Date.now(), mileage: e.mileage ?? v.mileage, ...e }];
  save('easyobd.journal', app.journal);
}

export function deleteJournal(id: string) {
  app.journal = app.journal.filter((j) => j.id !== id);
  save('easyobd.journal', app.journal);
}

/** First launch with the garage: migrate the single saved profile. */
export function migrateGarage() {
  if (!app.garage.length && app.profile) addVehicle(app.profile);
  else if (app.vehicleId && !currentVehicle()) selectVehicle(app.garage[0]?.id ?? null);
  else if (currentVehicle()) app.profile = currentVehicle()!.profile;
}

export function exportGarage(): string {
  return JSON.stringify({ format: 'easyobd-garage', version: 1, exported: new Date().toISOString(), garage: app.garage, journal: app.journal }, null, 2);
}

export function importGarage(json: string): number {
  const d = JSON.parse(json);
  if (d.format !== 'easyobd-garage' || !Array.isArray(d.garage)) throw new Error('fichier de garage EasyOBD attendu');
  const known = new Set(app.garage.map((v) => v.id));
  const add = (d.garage as GarageVehicle[]).filter((v) => !known.has(v.id));
  app.garage = [...app.garage, ...add];
  const jk = new Set(app.journal.map((j) => j.id));
  app.journal = [...app.journal, ...((d.journal ?? []) as JournalEntry[]).filter((j) => !jk.has(j.id))];
  save('easyobd.journal', app.journal);
  persistGarage();
  if (!app.vehicleId && app.garage.length) selectVehicle(app.garage[0].id);
  return add.length;
}

export function toast(text: string, kind: 'info' | 'error' | 'ok' = 'info') {
  app.toast = { text, kind };
  setTimeout(() => {
    if (app.toast?.text === text) app.toast = null;
  }, 4500);
}

export function componentName(id: string): string {
  return app.kb?.components[id] ?? app.kb?.components[id.replace(/_\d+$/, '_{n}')]?.replace('{n}', id.match(/_(\d+)$/)?.[1] ?? '') ?? id.replaceAll('_', ' ');
}

export async function bootstrap() {
  const [kb, maint] = await Promise.all([
    call<KbInfo>('kb_info'),
    call<{ disclaimer: string; vehicle_types: VehicleType[]; profiles: VehicleProfile[] }>('maintenance_info'),
  ]);
  app.kb = kb;
  app.vehicleTypes = maint.vehicle_types;
  app.profiles = maint.profiles;
  app.maintenanceDisclaimer = maint.disclaimer;
  migrateGarage();
}

/** Vehicle description for the 3D scene. */
export function sceneVehicle() {
  const p = app.profile;
  return { type: p?.type ?? 'car', cylinders: p?.cylinders ?? 4, fuel: p?.fuel ?? 'petrol', traction: p?.traction ?? 'front', make: p?.make ?? '' };
}

export const fmt = {
  eur: (a: number, b?: number) =>
    b === undefined || Math.round(a) === Math.round(b) ? `${Math.round(a)} €` : `${Math.round(a)}–${Math.round(b)} €`,
  time: (a: number, b: number) => {
    const f = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`);
    return a === b ? f(a) : `${f(a)} – ${f(b)}`;
  },
};

export const severityLabel: Record<string, string> = { low: 'Faible', medium: 'Modérée', high: 'Élevée', critical: 'Critique' };
export const compatLabel: Record<string, string> = { equivalent: 'Équivalent', compatible: 'Compatible', discouraged: 'Déconseillé', forbidden: 'À proscrire' };
export const sourceLabel: Record<string, string> = { vehicle: 'Modèle', make: 'Marque', typical: 'Typique' };
export const senseLabel: Record<string, string> = { sight: 'Vue', sound: 'Ouïe', smell: 'Odorat', touch: 'Toucher', feel: 'Ressenti' };
