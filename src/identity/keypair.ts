import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';
import {
  getAllActors,
  getActiveActorId,
  setActiveActorId,
  getActorById,
  saveActor,
  storedActorToKeyPair,
  type StoredActor,
} from './storage';
import type { Identity, KeyPair } from './types';

function generateKeyPair(): KeyPair {
  const { publicKey, secretKey } = nacl.sign.keyPair();
  return { publicKey, secretKey };
}

export function deriveNodeId(publicKey: Uint8Array): string {
  // Use first 16 bytes of public key hash as node ID
  const hash = nacl.hash(publicKey);
  return encodeBase64(hash.slice(0, 16))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function keyPairToIdentity(keyPair: KeyPair): Identity {
  return {
    keyPair,
    nodeId: deriveNodeId(keyPair.publicKey),
    publicKeyBase64: encodeBase64(keyPair.publicKey),
  };
}

export function createNewActor(name?: string): Identity {
  const keyPair = generateKeyPair();
  const nodeId = deriveNodeId(keyPair.publicKey);
  const actorName = name || `Actor ${new Date().toLocaleString()}`;

  saveActor(nodeId, actorName, keyPair);
  setActiveActorId(nodeId);

  return keyPairToIdentity(keyPair);
}

export function switchToActor(id: string): Identity | null {
  const stored = getActorById(id);
  if (!stored) return null;

  setActiveActorId(id);
  return keyPairToIdentity(storedActorToKeyPair(stored));
}

export function getOrCreateIdentity(): Identity {
  const actors = getAllActors();
  const activeId = getActiveActorId();

  // If we have an active actor, use it
  if (activeId) {
    const stored = getActorById(activeId);
    if (stored) {
      return keyPairToIdentity(storedActorToKeyPair(stored));
    }
  }

  // If we have any actors, use the first one
  if (actors.length > 0) {
    setActiveActorId(actors[0].id);
    return keyPairToIdentity(storedActorToKeyPair(actors[0]));
  }

  // Create a new actor
  return createNewActor('Default Actor');
}

export function getStoredActors(): StoredActor[] {
  return getAllActors();
}

export function getCurrentActorId(): string | null {
  return getActiveActorId();
}

export function importActorFromBase64(base64: string): Identity | null {
  try {
    const data = JSON.parse(atob(base64));

    if (!data.publicKey || !data.secretKey) {
      return null;
    }

    const keyPair: KeyPair = {
      publicKey: new Uint8Array(data.publicKey),
      secretKey: new Uint8Array(data.secretKey),
    };

    const nodeId = deriveNodeId(keyPair.publicKey);
    const name = data.name || `Imported ${new Date().toLocaleString()}`;

    saveActor(nodeId, name, keyPair);
    setActiveActorId(nodeId);

    return keyPairToIdentity(keyPair);
  } catch {
    return null;
  }
}

export function exportActorToBase64(id: string): string | null {
  const stored = getActorById(id);
  if (!stored) return null;

  const exportData = {
    name: stored.name,
    publicKey: stored.publicKey,
    secretKey: stored.secretKey,
  };

  return btoa(JSON.stringify(exportData));
}

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, secretKey);
}

export function verify(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  return nacl.sign.detached.verify(message, signature, publicKey);
}
