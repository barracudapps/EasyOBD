// Maintenance and technical-inspection reminders for a garage vehicle, computed locally from the
// vehicle (mileage, first registration, last inspection) and its maintenance log.
import type { GarageVehicle, JournalEntry } from './state.svelte';
import type { TutorialSummary } from './types';

export type ReminderStatus = 'overdue' | 'soon' | 'ok' | 'unknown';

export interface Reminder {
  id: string;
  title: string;
  status: ReminderStatus;
  detail: string;
  tutorialId?: string;
  /** Sort key: lower = more urgent. */
  urgency: number;
}

const MONTH = 30.44 * 24 * 3600e3;

function addMonths(d: Date, months: number) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

const fmtDate = (d: Date) => d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

/** Next technical inspection date (France): 4 years after first registration, then every 2 years
 *  (cars, vans); every year for trucks. Uses the last inspection date when known. */
export function nextInspection(v: GarageVehicle): Date | null {
  const type = v.profile.type;
  if (type === 'tractor') return null; // no periodic inspection for agricultural tractors in France
  const period = type === 'truck' ? 12 : 24;
  if (v.lastInspection) return addMonths(new Date(v.lastInspection), period);
  if (!v.firstRegistration) return null;
  const first = new Date(v.firstRegistration);
  if (type === 'truck') return addMonths(first, 12);
  if (type === 'motorcycle') return null; // progressive national calendar: see the inspection view
  let due = addMonths(first, 48);
  while (due.getTime() < Date.now() - 6 * MONTH) due = addMonths(due, 24);
  return due;
}

export function computeReminders(v: GarageVehicle, journal: JournalEntry[], tutorials: TutorialSummary[]): Reminder[] {
  const out: Reminder[] = [];
  const now = Date.now();
  const mine = journal.filter((j) => j.vehicleId === v.id);

  const ct = nextInspection(v);
  if (ct) {
    const months = (ct.getTime() - now) / MONTH;
    out.push({
      id: 'ct',
      title: 'Contrôle technique',
      status: months < 0 ? 'overdue' : months < 2 ? 'soon' : 'ok',
      detail: months < 0 ? `Échéance dépassée (${fmtDate(ct)})` : `Avant ${fmtDate(ct)}`,
      urgency: months,
    });
  } else if (v.profile.type !== 'motorcycle' && v.profile.type !== 'tractor') {
    out.push({ id: 'ct', title: 'Contrôle technique', status: 'unknown', detail: 'Renseignez la date de 1re mise en circulation (carte grise, rubrique B)', urgency: 50 });
  }

  for (const t of tutorials) {
    if (!t.interval_km && !t.interval_months) continue;
    const last = mine.filter((j) => j.kind === 'maintenance' && j.title === t.title).sort((a, b) => b.date - a.date)[0];
    if (!last) {
      out.push({ id: t.id, title: t.title, status: 'unknown', detail: 'Jamais enregistré : faites-le ou notez la dernière intervention', tutorialId: t.id, urgency: 40 });
      continue;
    }
    let urgency = Infinity;
    const parts: string[] = [];
    if (t.interval_months) {
      const due = addMonths(new Date(last.date), t.interval_months);
      const m = (due.getTime() - now) / MONTH;
      urgency = Math.min(urgency, m);
      parts.push(m < 0 ? `date dépassée (${fmtDate(due)})` : `avant ${fmtDate(due)}`);
    }
    if (t.interval_km && last.mileage && v.mileage) {
      const dueKm = last.mileage + t.interval_km;
      const left = dueKm - v.mileage;
      // Express km in "months" assuming ~1 250 km / month to compare with dates.
      urgency = Math.min(urgency, left / 1250);
      parts.push(left < 0 ? `${(-left).toLocaleString('fr-FR')} km de retard` : `dans ${left.toLocaleString('fr-FR')} km`);
    }
    out.push({
      id: t.id,
      title: t.title,
      status: urgency < 0 ? 'overdue' : urgency < 1 ? 'soon' : 'ok',
      detail: parts.join(' · ') || 'Fait',
      tutorialId: t.id,
      urgency,
    });
  }
  return out.sort((a, b) => a.urgency - b.urgency);
}
