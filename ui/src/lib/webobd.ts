// Real adapters in the browser (Chrome / Edge, incl. Chrome on Android):
// - Web Serial: USB ELM327 / OBDLink (and Bluetooth Classic adapters paired as serial ports on desktop)
// - Web Bluetooth: BLE adapters (Vgate iCar BLE, OBDLink CX, Veepeak BLE…)
// The browser only moves bytes; every answer is decoded by the Rust core (WASM `parse_response`).

/* eslint-disable @typescript-eslint/no-explicit-any */
type Wasm = {
  parse_response(cmd: string, raw: string, isCan?: boolean | null): string;
  init_sequence(): string;
  live_requests(): string;
};

export const webSerialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;
export const webBluetoothSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

interface ByteTransport {
  label: string;
  write(text: string): Promise<void>;
  onText: (t: string) => void;
  close(): Promise<void>;
}

class SerialTransport implements ByteTransport {
  label = 'USB (Web Serial)';
  onText: (t: string) => void = () => {};
  private port: any;
  private reader: any;
  private closed = false;

  static async open(baudRate = 38400): Promise<SerialTransport> {
    const t = new SerialTransport();
    t.port = await (navigator as any).serial.requestPort();
    await t.port.open({ baudRate });
    t.pump();
    return t;
  }

  private async pump() {
    const dec = new TextDecoder();
    while (!this.closed && this.port.readable) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          this.onText(dec.decode(value));
        }
      } catch {
        break;
      } finally {
        this.reader.releaseLock();
      }
    }
  }

  async write(text: string) {
    const w = this.port.writable.getWriter();
    await w.write(new TextEncoder().encode(text));
    w.releaseLock();
  }

  async close() {
    this.closed = true;
    try {
      await this.reader?.cancel();
      await this.port.close();
    } catch {
      /* already closed */
    }
  }
}

const BLE_SERVICES = [0xfff0, 0xffe0, 0x18f0, 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'];

class BleTransport implements ByteTransport {
  label = 'Bluetooth LE';
  onText: (t: string) => void = () => {};
  private device: any;
  private writeChar: any;

  static async open(): Promise<BleTransport> {
    const t = new BleTransport();
    t.device = await (navigator as any).bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
    const server = await t.device.gatt.connect();
    let notify: any = null;
    for (const uuid of BLE_SERVICES) {
      try {
        const svc = await server.getPrimaryService(uuid);
        const chars = await svc.getCharacteristics();
        notify = chars.find((c: any) => c.properties.notify || c.properties.indicate) ?? null;
        t.writeChar = chars.find((c: any) => c.properties.write || c.properties.writeWithoutResponse) ?? null;
        if (notify && t.writeChar) break;
      } catch {
        /* service not present on this adapter */
      }
    }
    if (!notify || !t.writeChar) throw new Error("service série BLE introuvable : cet appareil n'est pas un adaptateur OBD compatible");
    const dec = new TextDecoder();
    notify.addEventListener('characteristicvaluechanged', (e: any) => t.onText(dec.decode(e.target.value)));
    await notify.startNotifications();
    t.label = `Bluetooth LE ${t.device.name ?? ''}`.trim();
    return t;
  }

  async write(text: string) {
    const data = new TextEncoder().encode(text);
    for (let i = 0; i < data.length; i += 20) {
      const chunk = data.slice(i, i + 20);
      if (this.writeChar.properties.writeWithoutResponse) await this.writeChar.writeValueWithoutResponse(chunk);
      else await this.writeChar.writeValue(chunk);
    }
  }

  async close() {
    try {
      this.device?.gatt?.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export class WebObdSession {
  private buf = '';
  private waiter: (() => void) | null = null;
  isCan: boolean | null = null;
  make: string | null = null;

  constructor(private t: ByteTransport, private wasm: Wasm, private lookup: (code: string, make?: string | null) => Promise<unknown>) {
    t.onText = (s) => {
      this.buf += s;
      this.waiter?.();
    };
  }

  static async open(kind: 'webserial' | 'webble', wasm: Wasm, lookup: (code: string, make?: string | null) => Promise<unknown>, baud?: number) {
    const t = kind === 'webserial' ? await SerialTransport.open(baud ?? 38400) : await BleTransport.open();
    return new WebObdSession(t, wasm, lookup);
  }

  /** Sends a command and resolves with the text before the `>` prompt. */
  async command(cmd: string, timeoutMs = 5000): Promise<string> {
    this.buf = '';
    await this.t.write(`${cmd}\r`);
    const deadline = Date.now() + timeoutMs;
    while (!this.buf.includes('>')) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`délai dépassé (${cmd}) : l'adaptateur ne répond pas`);
      await new Promise<void>((r) => {
        this.waiter = r;
        setTimeout(r, Math.min(left, 200));
      });
    }
    const raw = this.buf.split('>')[0];
    this.buf = '';
    return raw;
  }

  /** Runs a monitor command (ATDM1…) for `ms`, then stops it with a carriage return. */
  async monitor(cmd: string, ms: number): Promise<string> {
    this.buf = '';
    await this.t.write(`${cmd}\r`);
    await new Promise((r) => setTimeout(r, ms));
    if (!this.buf.includes('>')) {
      await this.t.write('\r');
      const end = Date.now() + 2000;
      while (!this.buf.includes('>') && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    }
    const raw = this.buf.split('>')[0];
    this.buf = '';
    return raw;
  }

  /** Heavy vehicles: SAE J1939 (CAN 29 bit 250 kbaud) with headers, no OBD-II probe. */
  async connectJ1939() {
    const reset = await this.command('ATZ', 3000);
    const elm = reset.split(/[\r\n]/).map((l) => l.trim()).find((l) => /ELM|STN/i.test(l)) ?? 'ELM327';
    for (const cmd of ['ATE0', 'ATL0', 'ATS1', 'ATH1', 'ATSPA']) {
      const r = await this.command(cmd);
      if (r.includes('?')) throw new Error(`l'adaptateur refuse « ${cmd} » : il ne gère pas le J1939 (ELM327 v1.4b+ ou OBDLink requis)`);
    }
    const bat = await this.ask('ATRV').catch(() => ({ battery_v: null }));
    return {
      adapter: { transport: this.t.label, elm_version: elm, protocol_number: 10, protocol: 'SAE J1939 CAN' },
      vehicle: {},
      monitor: null,
      battery_v: bat.battery_v,
      simulated: false,
      j1939: true,
    };
  }

  async readJ1939(decode: (raw: string, rawDm2: string | null) => Promise<unknown>) {
    const raw = await this.monitor('ATDM1', 3500);
    if (raw.includes('?')) throw new Error("l'adaptateur ne connaît pas ATDM1 (J1939) : ELM327 v1.4b+, OBDLink ou STN requis");
    // DM2 (previously active faults): request PGN 65227, ELM format. Optional: some ECUs do not answer.
    let dm2: string | null = null;
    try {
      dm2 = await this.command('00FECB', 3000);
      if (dm2.includes('?')) dm2 = null;
    } catch {
      dm2 = null;
    }
    return decode(raw, dm2);
  }

  /** DM11: asks every ECU to clear its diagnostic information; returns the raw acknowledgements. */
  async clearJ1939() {
    const raw = await this.command('00FED3', 3000);
    if (raw.includes('?')) throw new Error("l'adaptateur refuse la requête J1939 (DM11)");
    return raw;
  }

  private async ask<T = any>(cmd: string, timeoutMs?: number): Promise<T> {
    const raw = await this.command(cmd, timeoutMs);
    return JSON.parse(this.wasm.parse_response(cmd, raw, this.isCan));
  }

  async connect() {
    let elm = 'ELM327';
    let proto: any = {};
    for (const cmd of JSON.parse(this.wasm.init_sequence()) as string[]) {
      const timeout = cmd === 'ATZ' ? 3000 : cmd === '0100' ? 15000 : 5000;
      const raw = await this.command(cmd, timeout);
      if (cmd === '0100') this.wasm.parse_response(cmd, raw, null); // throws "unable to connect" if the car does not answer
      const v = JSON.parse(this.wasm.parse_response(cmd, raw, null));
      if (cmd === 'ATZ') elm = v.elm_version;
      if (cmd === 'ATDPN') proto = v;
    }
    this.isCan = proto.is_can ?? null;
    const vehicle = (await this.ask('0902').catch(() => ({ vehicle: {} }))).vehicle;
    this.make = vehicle?.make ?? null;
    const mon = await this.ask('0101').catch(() => ({ monitor: null }));
    const bat = await this.ask('ATRV').catch(() => ({ battery_v: null }));
    return {
      adapter: { transport: this.t.label, elm_version: elm, protocol_number: proto.protocol_number, protocol: proto.protocol },
      vehicle,
      monitor: mon.monitor,
      battery_v: bat.battery_v,
      simulated: false,
    };
  }

  async readDtcs() {
    const all: { code: string; kind: string }[] = [];
    for (const cmd of ['03', '07', '0A']) {
      try {
        all.push(...(await this.ask(cmd)).dtcs);
      } catch (e) {
        if (cmd === '03') throw e; // pending / permanent are optional on older cars
      }
    }
    return Promise.all(all.map(async (d) => ({ ...d, diagnosis: await this.lookup(d.code, this.make).catch(() => null) })));
  }

  async readLive() {
    const values = [];
    for (const [cmd] of JSON.parse(this.wasm.live_requests()) as [string, string][]) {
      const v = await this.ask(cmd).catch(() => ({ value: null }));
      if (v.value) values.push(v.value);
    }
    const bat = await this.ask('ATRV').catch(() => ({ battery_v: null }));
    return { values, battery_v: bat.battery_v };
  }

  async clear() {
    const v = await this.ask('04');
    if (!v.cleared) throw new Error('effacement refusé par le véhicule (moteur tournant ?)');
    return null;
  }

  async precheck() {
    const mon = await this.ask('0101');
    const dtcs = (await this.ask('03')).dtcs;
    const readiness = mon.readiness as { name: string; complete: boolean }[];
    const incomplete = readiness.filter((m) => !m.complete).length;
    const mil = !!mon.monitor?.mil_on;
    const advice: string[] = [];
    if (mil) advice.push('Voyant moteur allumé : défaillance majeure au contrôle technique. Réparez avant de vous présenter.');
    if (dtcs.length && !mil) advice.push('Des codes sont enregistrés sans voyant : consultez-les, ils annoncent souvent un futur voyant.');
    if (incomplete) advice.push(`${incomplete} autodiagnostic(s) non terminé(s) : roulez 50 à 150 km (ville + voie rapide) avant le contrôle.`);
    if (!advice.length) advice.push('Tout est en ordre côté calculateur moteur.');
    return { mil_on: mil, dtcs, readiness, ready: !mil && !dtcs.length && !incomplete, advice };
  }

  close() {
    return this.t.close();
  }
}
