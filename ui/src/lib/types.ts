export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Sense = 'sight' | 'sound' | 'smell' | 'touch' | 'feel';

export interface ShopLink { provider: string; name: string; url: string; color?: string | null }
export interface Part { name: string; qty: number; price_min: number; price_max: number; links: ShopLink[] }
export interface Cost { parts_min: number; parts_max: number; labor_min: number; labor_max: number; garage_min: number; garage_max: number }
export interface Solution {
  title: string; description?: string | null; difficulty: number; difficulty_label: string;
  time_min: number; time_max: number; tools: string[]; steps: string[]; parts: Part[]; cost: Cost;
}
export interface SensoryCheck { sense: Sense; tip: string; means?: string | null }
export interface Diagnosis {
  code: string; match_kind: 'exact' | 'range' | 'generic'; manufacturer_specific: boolean;
  title: string; description: string; system: string; severity: Severity; drivable: string;
  how_it_works?: string | null; sensory_checks: SensoryCheck[]; symptoms: string[];
  components: { id: string; name: string }[]; causes: { text: string; likelihood: number }[]; solutions: Solution[];
}
export interface CatalogItem { code: string; title: string; system: string; severity: Severity }
export interface KbInfo {
  version: string; labor_rate_eur_h: number; providers: ShopLink[];
  components: Record<string, string>; catalog: CatalogItem[];
}

export type ConnKind = 'simulator' | 'wifi' | 'serial' | 'ble' | 'webserial' | 'webble';
export interface ConnectionSpec { kind: ConnKind; address: string; baud?: number | null }
export interface AdapterCandidate {
  spec: ConnectionSpec; label: string; medium: 'usb' | 'bluetooth' | 'ble' | 'wifi' | 'simulator';
  verified: boolean; chip?: string | null; clone_suspected: boolean; note?: string | null;
}
export interface VehicleInfo { vin?: string | null; make?: string | null; model_year?: number | null; country?: string | null }
export interface ConnectResult {
  adapter: { transport: string; elm_version: string; protocol_number?: number | null; protocol: string };
  vehicle: VehicleInfo; monitor?: { mil_on: boolean; dtc_count: number } | null; battery_v?: number | null; simulated: boolean;
}
export interface DtcItem { code: string; kind: 'stored' | 'pending' | 'permanent'; diagnosis: Diagnosis | null }
export interface LiveValue { key: string; label: string; unit: string; min: number; max: number; value: number }

export interface VehicleType { id: string; name: string; icon: string }
export interface VehicleProfile {
  id: string; type: string; make: string; model: string; engine: string; years?: [number, number] | null;
  fuel: string; cylinders?: number | null; oil_capacity_l?: number | null; oil_spec?: string | null;
  coolant_l?: number | null; chain?: string | null; traction?: string | null;
}
export interface TutorialSummary { id: string; title: string; interval: string; interval_km?: number | null; interval_months?: number | null; difficulty: number; time_min: number; time_max: number }
export interface TutorialStep { title: string; text: string; components: string[]; tip?: string | null; warning?: string | null; source?: string | null }
export interface Tutorial extends TutorialSummary {
  why: string; sensory_checks: SensoryCheck[]; components: string[]; tools: string[]; safety: string[]; steps: TutorialStep[];
  vehicle_notes: string[];
}
export type Compatibility = 'equivalent' | 'compatible' | 'discouraged' | 'forbidden';
export interface Alternative { label: string; compatibility: Compatibility; saving?: string | null; note: string }
export interface SpecItem { label: string; value: string; source: 'vehicle' | 'make' | 'typical'; note?: string | null }
export interface VehicleSheet { vehicle: string; sections: { title: string; items: SpecItem[] }[]; oil_alternatives: Alternative[]; disclaimer: string }
export interface CheckItem { id: string; label: string; how: string; sense: Sense; severity: 'minor' | 'major' | 'critical'; components: string[] }
export interface InspectionGuide {
  vehicle: string; periodicity: string; severity_labels: Record<string, string>;
  sections: { title: string; items: CheckItem[] }[]; vin: { make_places: string[]; generic: { place: string; detail: string }[] }; disclaimer: string;
}
export interface Precheck {
  mil_on: boolean; ready: boolean; advice: string[]; readiness: { name: string; complete: boolean }[];
  dtcs: { code: string; kind: string }[];
}
export interface ShoppingItem { name: string; qty: number; unit: string; optional: boolean; qty_known: boolean; price_min: number; price_max: number; links: ShopLink[] }
export interface ShoppingList { vehicle: string; items: ShoppingItem[]; total_min: number; total_max: number; labor_min: number; labor_max: number }

export interface Condition { question: string; options: string[] }
export interface Question {
  id: string; sense: Sense; multi: boolean; text: string; help?: string | null;
  options: { id: string; label: string; note?: string | null }[];
  show_if?: Condition | null; hide_if?: Condition | null;
}
export interface RankedHypothesis {
  id: string; title: string; explanation: string; score: number; relative: number; strength: string;
  evidence: string[]; codes: { code: string; title: string }[]; components: string[]; next_checks: string[];
  severity: Severity; tutorial?: string | null;
}
export interface Evidence { hypothesis: string; weight: number; label: string }

export interface AudioFinding { id: string; title: string; confidence: number; explanation: string; hypotheses: string[] }
export interface AudioReport {
  duration_s: number; level_db: number; firing_hz?: number | null; estimated_rpm?: number | null; cylinders_assumed: number;
  periodicity: number; misfire_index?: number | null; tones: { hz: number; prominence_db: number }[];
  findings: AudioFinding[]; warnings: string[]; spectrum_db: number[]; spectrum_hz: number[]; envelope: number[];
}

export interface Scenario {
  id: string; title: string; level: number; profile: string; story: string;
  codes: { code: string; kind: string }[]; clues: { sense: Sense; text: string }[];
  question: { text: string; options: { text: string; correct: boolean; feedback: string }[] }; debrief: string;
}

export interface EcuReport {
  tx: number; name: string; identification: { did: number; name: string; value: string }[];
  dtcs: { code: string; failure_type: number; status: number; confirmed: boolean; pending: boolean; mil: boolean }[];
  error?: string | null;
}
export interface WriteRecord { ecu: number; did: number; before?: string | null; written: string; after?: string | null; verified: boolean }
