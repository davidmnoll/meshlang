import type { DatalogStore } from '../datalog/store';
import type { Mesh } from '../network/mesh';
import type { Identity } from '../identity/types';
import { createSyncState, type SyncState } from './crdt';

export class SyncManager {
  private state: SyncState;
  public readonly identity: Identity;

  constructor(
    identity: Identity,
    store: DatalogStore,
    _mesh: Mesh
  ) {
    this.identity = identity;
    this.state = createSyncState();

    // Track facts as they're added
    store.onAdd((fact) => {
      this.state.factIds.add(fact.id);
    });

    // Initialize with existing facts
    for (const fact of store.all()) {
      this.state.factIds.add(fact.id);
    }
  }

  getLocalFactIds(): string[] {
    return Array.from(this.state.factIds);
  }

  hasFactId(id: string): boolean {
    return this.state.factIds.has(id);
  }
}
