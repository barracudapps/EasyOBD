// Global application state (Svelte 5 runes). Persisted bits use localStorage defensively.
import { call } from './api';
import type { ConnectResult, DtcItem, KbInfo, VehicleProfile, VehicleType } from './types';

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

export type View = 'home' | 'diagnostic' | 'eye' | 'audio' | 'maintenance' | 'training' | 'codes' | 'expert';

export const app = $state({
  view: load<View>('easyobd.view', 'home'),
  theme: load<'dark' | 'light'>('easyobd.theme', 'dark'),
  kb: null as KbInfo | null,
  vehicleTypes: [] as VehicleType[],
  profiles: [] as VehicleProfile[],
  maintenanceDisclaimer: '',
  profile: load<VehicleProfile | null>('easyobd.profile', null),
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

export function setProfile(p: VehicleProfile | null) {
  app.profile = p;
  save('easyobd.profile', p);
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
}

/** Vehicle description for the 3D scene. */
export function sceneVehicle() {
  const p = app.profile;
  return { type: p?.type ?? 'car', cylinders: p?.cylinders ?? 4, fuel: p?.fuel ?? 'petrol' };
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
export const senseLabel: Record<string, string> = { sight: 'Vue', sound: 'Ouïe', smell: 'Odorat', touch: 'Toucher', feel: 'Ressenti' };
