import {
  getOrCreateIdentity,
  switchToActor,
  createNewActor,
  importActorFromBase64,
  exportActorToBase64,
  getStoredActors,
  getCurrentActorId,
} from './identity/keypair';
import { deleteActor, renameActor } from './identity/storage';
import type { Identity } from './identity/types';
import { DatalogStore } from './datalog/store';
import { Mesh } from './network/mesh';
import { renderApp } from './ui/outliner';

export interface AppState {
  identity: Identity;
  store: DatalogStore;
  mesh: Mesh;
}

let currentState: AppState | null = null;

function createAppState(identity: Identity): AppState {
  const store = new DatalogStore();
  const mesh = new Mesh(identity, store);
  return { identity, store, mesh };
}

export function getAppState(): AppState | null {
  return currentState;
}

export function switchIdentity(actorId: string): boolean {
  const newIdentity = switchToActor(actorId);
  if (!newIdentity) return false;

  // Close existing mesh connections
  // (In a real app, you'd want to gracefully disconnect)

  currentState = createAppState(newIdentity);
  initActorNameFact(newIdentity, currentState.store);
  console.log('Switched to Node ID:', newIdentity.nodeId);

  // Re-render the app
  const appEl = document.getElementById('app');
  if (appEl) {
    renderApp(appEl, currentState, {
      onSwitchActor: switchIdentity,
      onCreateActor: handleCreateActor,
      onImportActor: handleImportActor,
      onExportActor: handleExportActor,
      onDeleteActor: handleDeleteActor,
      onRenameActor: handleRenameActor,
      getActors: getStoredActors,
      getCurrentActorId,
    });
  }

  return true;
}

function handleCreateActor(name?: string): Identity {
  const identity = createNewActor(name);
  currentState = createAppState(identity);
  initActorNameFact(identity, currentState.store);

  const appEl = document.getElementById('app');
  if (appEl) {
    renderApp(appEl, currentState, {
      onSwitchActor: switchIdentity,
      onCreateActor: handleCreateActor,
      onImportActor: handleImportActor,
      onExportActor: handleExportActor,
      onDeleteActor: handleDeleteActor,
      onRenameActor: handleRenameActor,
      getActors: getStoredActors,
      getCurrentActorId,
    });
  }

  return identity;
}

function handleImportActor(base64: string): Identity | null {
  const identity = importActorFromBase64(base64);
  if (!identity) return null;

  currentState = createAppState(identity);
  initActorNameFact(identity, currentState.store);

  const appEl = document.getElementById('app');
  if (appEl) {
    renderApp(appEl, currentState, {
      onSwitchActor: switchIdentity,
      onCreateActor: handleCreateActor,
      onImportActor: handleImportActor,
      onExportActor: handleExportActor,
      onDeleteActor: handleDeleteActor,
      onRenameActor: handleRenameActor,
      getActors: getStoredActors,
      getCurrentActorId,
    });
  }

  return identity;
}

function handleExportActor(actorId: string): string | null {
  return exportActorToBase64(actorId);
}

function handleDeleteActor(actorId: string): boolean {
  const actors = getStoredActors();
  if (actors.length <= 1) {
    alert('Cannot delete the last actor');
    return false;
  }

  deleteActor(actorId);

  // If we deleted the current actor, switch to another
  if (currentState?.identity.nodeId === actorId) {
    const remaining = getStoredActors();
    if (remaining.length > 0) {
      switchIdentity(remaining[0].id);
    }
  }

  return true;
}

function handleRenameActor(actorId: string, newName: string): void {
  renameActor(actorId, newName);
}

function initActorNameFact(identity: Identity, store: DatalogStore): void {
  // Add name fact for current actor if not already present
  // Using 2-tuple format: ['name', value] with scope = nodeId
  const existingName = store.findByScope(identity.nodeId)
    .find((f) => f.fact[0] === 'name');
  if (!existingName) {
    const actor = getStoredActors().find((a) => a.id === identity.nodeId);
    const name = actor?.name || identity.nodeId;
    store.add(['name', name], identity.nodeId, identity.nodeId);
  }
}

function main() {
  const identity = getOrCreateIdentity();
  console.log('Node ID:', identity.nodeId);

  currentState = createAppState(identity);
  initActorNameFact(identity, currentState.store);

  renderApp(document.getElementById('app')!, currentState, {
    onSwitchActor: switchIdentity,
    onCreateActor: handleCreateActor,
    onImportActor: handleImportActor,
    onExportActor: handleExportActor,
    onDeleteActor: handleDeleteActor,
    onRenameActor: handleRenameActor,
    getActors: getStoredActors,
    getCurrentActorId,
  });
}

main();
