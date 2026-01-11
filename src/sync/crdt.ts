import type { FactId } from '../datalog/types';

// Simple grow-only set CRDT for facts
// Facts are immutable and can only be added, never removed

export interface SyncState {
  factIds: Set<FactId>;
  vectorClock: Map<string, number>; // nodeId -> lamport timestamp
}

export function createSyncState(): SyncState {
  return {
    factIds: new Set(),
    vectorClock: new Map(),
  };
}

export function mergeSyncState(local: SyncState, remote: SyncState): SyncState {
  const merged: SyncState = {
    factIds: new Set([...local.factIds, ...remote.factIds]),
    vectorClock: new Map(local.vectorClock),
  };

  for (const [nodeId, timestamp] of remote.vectorClock) {
    const localTime = merged.vectorClock.get(nodeId) || 0;
    merged.vectorClock.set(nodeId, Math.max(localTime, timestamp));
  }

  return merged;
}

export function diffFacts(
  local: Set<FactId>,
  remote: Set<FactId>
): { missing: FactId[]; extra: FactId[] } {
  const missing: FactId[] = []; // Facts remote has that local doesn't
  const extra: FactId[] = []; // Facts local has that remote doesn't

  for (const id of remote) {
    if (!local.has(id)) {
      missing.push(id);
    }
  }

  for (const id of local) {
    if (!remote.has(id)) {
      extra.push(id);
    }
  }

  return { missing, extra };
}

export function incrementClock(state: SyncState, nodeId: string): number {
  const current = state.vectorClock.get(nodeId) || 0;
  const next = current + 1;
  state.vectorClock.set(nodeId, next);
  return next;
}
