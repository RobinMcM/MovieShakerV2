/**
 * localFileStore — persists a FileSystemDirectoryHandle in IndexedDB so the
 * user only needs to grant access to their working directory once per browser.
 *
 * Uses the Filesystem Access API (Chrome/Edge). Safari doesn't support
 * showDirectoryPicker, so all functions degrade gracefully when unavailable.
 */

const DB_NAME = "movieshaker-local-files";
const STORE_NAME = "directory-handles";
const HANDLE_KEY = "working-directory";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirectoryHandle(
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearDirectoryHandle(): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

/** Returns true if the browser supports the Filesystem Access API. */
export function supportsLocalDirectory(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export interface LocalFile {
  name: string;
  size: number;
  type: string;
  handle: FileSystemFileHandle;
}

const VIDEO_AUDIO_EXTENSIONS = new Set([
  "mp4", "mov", "avi", "webm", "mkv", "mpeg", "mpg", "ogv",
  "mp3", "m4a", "wav", "aac", "ogg", "flac",
]);

/** List video/audio files in a directory handle (non-recursive). */
export async function listMediaFiles(
  dir: FileSystemDirectoryHandle
): Promise<LocalFile[]> {
  const files: LocalFile[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "file") continue;
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (!VIDEO_AUDIO_EXTENSIONS.has(ext)) continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    files.push({ name, size: file.size, type: file.type || `video/${ext}`, handle: handle as FileSystemFileHandle });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/** Verify that a persisted handle still has read-write permission (re-requests if needed). */
export async function verifyPermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  try {
    // @ts-expect-error — queryPermission is not yet in all TS lib defs
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm === "granted") return true;
    // @ts-expect-error
    const req = await handle.requestPermission({ mode: "readwrite" });
    return req === "granted";
  } catch {
    return false;
  }
}

/** Write (or overwrite) a text file in the working directory. */
export async function writeFileToDirectory(
  dir: FileSystemDirectoryHandle,
  filename: string,
  content: string
): Promise<void> {
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}
