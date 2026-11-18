// Checks that every tutorial step highlights at least one part that exists in the 3D model of each
// vehicle kind it applies to (otherwise the viewer falls back to a misleading part).
// Run by scripts/check.sh: bundled with esbuild, executed with node.
import * as fs from 'fs';
import { buildVehicle, type VehicleSpec } from '../src/lib/three/vehicles';

const data = JSON.parse(fs.readFileSync(process.argv[2] ?? '../data/maintenance.fr.json', 'utf8'));
const specs: (VehicleSpec & { finalDrive?: string })[] = [
  { type: 'car', cylinders: 4, fuel: 'petrol' },
  { type: 'car', cylinders: 4, fuel: 'diesel' },
  { type: 'car', cylinders: 4, fuel: 'hybrid' },
  { type: 'car', cylinders: 6, fuel: 'petrol', make: 'Porsche', model: '911', enginePosition: 'rear', body: 'coupe' },
  { type: 'car', cylinders: 8, fuel: 'petrol', make: 'Ferrari', enginePosition: 'mid', body: 'supercar' },
  { type: 'car', cylinders: 0, fuel: 'electric', make: 'Tesla', model: 'Model 3' },
  { type: 'van', cylinders: 4, fuel: 'diesel' },
  { type: 'van', cylinders: 0, fuel: 'electric' },
  { type: 'truck', cylinders: 6, fuel: 'diesel' },
  { type: 'tractor', cylinders: 4, fuel: 'diesel' },
  { type: 'motorcycle', cylinders: 2, fuel: 'petrol', finalDrive: 'chain' },
  { type: 'motorcycle', cylinders: 3, fuel: 'petrol', finalDrive: 'shaft', body: 'adventure' },
  { type: 'motorcycle', cylinders: 2, fuel: 'petrol', finalDrive: 'belt', body: 'cruiser' },
  { type: 'motorcycle', cylinders: 1, fuel: 'petrol', finalDrive: 'cvt', body: 'scooter' },
  { type: 'motorcycle', cylinders: 0, fuel: 'electric', finalDrive: 'belt' },
  { type: 'motorcycle', cylinders: 0, fuel: 'electric', finalDrive: 'chain' },
];

const errors: string[] = [];
const everywhere = new Set<string>();
for (const spec of specs) {
  const ids = new Set<string>();
  buildVehicle(spec).traverse((o) => o.userData.componentId && ids.add(o.userData.componentId));
  ids.forEach((id) => everywhere.add(id));
  const label = `${spec.type}/${spec.fuel}${spec.finalDrive ? '/' + spec.finalDrive : ''}${spec.make ? ' ' + spec.make : ''}`;
  for (const t of data.tutorials) {
    if (!t.vehicle_types.includes(spec.type)) continue;
    if (t.fuels && !t.fuels.includes(spec.fuel)) continue;
    if (t.final_drives && !t.final_drives.includes(spec.finalDrive ?? 'chain')) continue;
    if (t.makes && !t.makes.includes(spec.make)) continue;
    t.steps.forEach((s: { title: string; components?: string[] }, i: number) => {
      const c = s.components ?? [];
      if (c.length && !c.some((id) => ids.has(id))) errors.push(`${label}: ${t.id} step ${i + 1} "${s.title}" → none of ${c.join(', ')}`);
    });
  }
}
// Vehicle-specific procedure steps: each part must exist in at least one model.
for (const pr of data.procedures) {
  for (const s of [...(pr.steps_before ?? []), ...(pr.replace_steps ?? [])]) {
    const c: string[] = s.components ?? [];
    if (c.length && !c.some((id) => everywhere.has(id))) errors.push(`procedure ${JSON.stringify(pr.match)}: "${s.title}" → none of ${c.join(', ')}`);
  }
}
if (errors.length) {
  console.error(`3D highlight audit: ${errors.length} step(s) point at parts missing from the model:\n` + errors.join('\n'));
  process.exit(1);
}
