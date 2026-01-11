import type { KeyPair } from './types';

const STORAGE_KEY = 'meshlang_actors';
const ACTIVE_KEY = 'meshlang_active_actor';
const OLD_STORAGE_KEY = 'meshlang_keys';
const OLD_ACTIVE_KEY = 'meshlang_active_key';

export interface StoredActor {
  id: string;
  name: string;
  publicKey: number[];
  secretKey: number[];
  createdAt: number;
}

export interface ActorStore {
  actors: StoredActor[];
}

function loadStore(): ActorStore {
  // Try new storage key first
  const data = localStorage.getItem(STORAGE_KEY);
  if (data) {
    try {
      const parsed = JSON.parse(data);
      // Handle both old format (keys) and new format (actors)
      const actors = parsed.actors || parsed.keys || [];
      return { actors };
    } catch {
      return { actors: [] };
    }
  }

  // Migrate from old storage key if it exists
  const oldData = localStorage.getItem(OLD_STORAGE_KEY);
  if (oldData) {
    try {
      const oldStore = JSON.parse(oldData);
      const newStore: ActorStore = { actors: oldStore.keys || [] };
      // Save to new key and remove old key
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newStore));
      localStorage.removeItem(OLD_STORAGE_KEY);
      // Also migrate active key
      const oldActiveId = localStorage.getItem(OLD_ACTIVE_KEY);
      if (oldActiveId) {
        localStorage.setItem(ACTIVE_KEY, oldActiveId);
        localStorage.removeItem(OLD_ACTIVE_KEY);
      }
      return newStore;
    } catch {
      return { actors: [] };
    }
  }

  return { actors: [] };
}

function saveStore(store: ActorStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function getActiveActorId(): string | null {
  const activeId = localStorage.getItem(ACTIVE_KEY);
  if (activeId) return activeId;

  // Check old key and migrate if exists
  const oldActiveId = localStorage.getItem(OLD_ACTIVE_KEY);
  if (oldActiveId) {
    localStorage.setItem(ACTIVE_KEY, oldActiveId);
    localStorage.removeItem(OLD_ACTIVE_KEY);
    return oldActiveId;
  }

  return null;
}

export function setActiveActorId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function getAllActors(): StoredActor[] {
  return loadStore().actors;
}

export function getActorById(id: string): StoredActor | null {
  const store = loadStore();
  return store.actors.find((k) => k.id === id) || null;
}

export function saveActor(id: string, name: string, keyPair: KeyPair): void {
  const store = loadStore();
  const existing = store.actors.findIndex((k) => k.id === id);

  const storedActor: StoredActor = {
    id,
    name,
    publicKey: Array.from(keyPair.publicKey),
    secretKey: Array.from(keyPair.secretKey),
    createdAt: Date.now(),
  };

  if (existing >= 0) {
    store.actors[existing] = storedActor;
  } else {
    store.actors.push(storedActor);
  }

  saveStore(store);
}

export function deleteActor(id: string): void {
  const store = loadStore();
  store.actors = store.actors.filter((k) => k.id !== id);
  saveStore(store);

  // If we deleted the active actor, clear active
  if (getActiveActorId() === id) {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function renameActor(id: string, newName: string): void {
  const store = loadStore();
  const actor = store.actors.find((k) => k.id === id);
  if (actor) {
    actor.name = newName;
    saveStore(store);
  }
}

export function storedActorToKeyPair(stored: StoredActor): KeyPair {
  return {
    publicKey: new Uint8Array(stored.publicKey),
    secretKey: new Uint8Array(stored.secretKey),
  };
}

