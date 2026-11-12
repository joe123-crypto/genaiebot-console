/** The chosen pictures, carried between the two creation steps without a round
 *  trip: an in-memory map for the client navigation, and IndexedDB so a reload
 *  in the caption step does not lose them. Nothing here leaves the browser. */
const DB = "genaie-campaign-create";
const STORE = "pictures";
const RECORD = "draft";

let memory = new Map<string, File>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function write(value: Map<string, File> | null) {
  const database = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const store = database.transaction(STORE, "readwrite").objectStore(STORE);
      const request = value ? store.put(value, RECORD) : store.delete(RECORD);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

export async function keepDraftFiles(files: Map<string, File>) {
  memory = new Map(files);
  // A browser that refuses storage still carries them through this tab.
  try { await write(memory); } catch { /* The in-memory map is the fallback. */ }
}

export async function draftFiles(): Promise<Map<string, File>> {
  if (memory.size) return new Map(memory);
  try {
    const database = await open();
    try {
      const stored = await new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(STORE, "readonly").objectStore(STORE).get(RECORD);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (stored instanceof Map) { memory = stored as Map<string, File>; return new Map(memory); }
    } finally { database.close(); }
  } catch { /* Nothing kept; the operator chooses the pictures again. */ }
  return new Map();
}

export async function forgetDraftFiles() {
  memory = new Map();
  try { await write(null); } catch { /* Nothing was kept. */ }
}
