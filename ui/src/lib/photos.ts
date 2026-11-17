// Photos assisting operations.
// - Reference photos: light WebP files in ui/public/photos/, listed in manifest.json with credit and licence
//   (freely licensed sources only, e.g. Wikimedia Commons).
// - User photos: taken or picked by the user, resized + compressed in the browser, stored locally in IndexedDB.

export interface RefPhoto { file: string; alt: string; credit: string; license: string; source: string }
export interface UserPhoto { id: string; key: string; blob: Blob; created: number; note?: string }

let manifest: Record<string, RefPhoto[]> | null = null;

export async function referencePhotos(ids: string[]): Promise<RefPhoto[]> {
  if (!manifest) {
    try {
      const r = await fetch(new URL('photos/manifest.json', document.baseURI));
      manifest = r.ok ? await r.json() : {};
    } catch {
      manifest = {};
    }
  }
  const seen = new Set<string>();
  const out: RefPhoto[] = [];
  for (const id of ids) {
    const base = id.replace(/_(\d+|fl|fr|rl|rr)$/, '');
    for (const p of manifest![id] ?? manifest![base] ?? manifest![base.replace(/^brake$/, 'brake')] ?? []) {
      if (!seen.has(p.file)) {
        seen.add(p.file);
        out.push(p);
      }
    }
  }
  return out;
}

export function photoUrl(p: RefPhoto) {
  return new URL(`photos/${p.file}`, document.baseURI).href;
}

// ---- User photos (IndexedDB) ------------------------------------------------------------------

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('easyobd', 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore('photos', { keyPath: 'id' });
      s.createIndex('key', 'key');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function userPhotos(key: string): Promise<UserPhoto[]> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const r = d.transaction('photos').objectStore('photos').index('key').getAll(key);
      r.onsuccess = () => resolve((r.result as UserPhoto[]).sort((a, b) => a.created - b.created));
      r.onerror = () => reject(r.error);
    });
  } catch {
    return [];
  }
}

/** Resizes to max 1024 px and encodes as WebP (fallback JPEG) ≈ 60–150 KB. */
export async function compress(file: File, max = 1024): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.72));
  return blob ?? (await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.75)));
}

export async function addUserPhoto(key: string, file: File, note?: string): Promise<void> {
  const blob = await compress(file);
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction('photos', 'readwrite');
    tx.objectStore('photos').put({ id: crypto.randomUUID(), key, blob, created: Date.now(), note } satisfies UserPhoto);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteUserPhoto(id: string): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
