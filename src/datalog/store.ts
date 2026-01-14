import type { Fact, FactId, StoredFact, Value, Scope } from './types';

// Simple deterministic hash (djb2 algorithm)
// For production, replace with SHA-256
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// Scope metadata - computed properties not stored as facts
export interface ScopeMeta {
  hash: string;           // Content hash of all facts in scope
  visibleTo: Set<string>; // Peer IDs that can see this scope
  lastModified: number;   // Timestamp of last change
}

export class DatalogStore {
  private facts: Map<FactId, StoredFact> = new Map();
  private byScope: Map<string, Set<FactId>> = new Map();
  private byKey: Map<string, Set<FactId>> = new Map();
  private byValue: Map<string, Set<FactId>> = new Map();
  private listeners: Set<(fact: StoredFact) => void> = new Set();

  // Scope metadata (hashes, visibility)
  private scopeMeta: Map<Scope, ScopeMeta> = new Map();
  private hashChangeListeners: Set<(scope: Scope, oldHash: string, newHash: string) => void> = new Set();

  private valueKey(v: Value): string {
    return JSON.stringify(v);
  }

  private factId(fact: Fact, scope: Scope): FactId {
    // scope:key:value
    return `${scope}:${fact[0]}:${this.valueKey(fact[1])}`;
  }

  add(fact: Fact, source: string, scope?: Scope): StoredFact | null {
    // Scope defaults to source (the actor adding the fact)
    const actualScope = scope ?? source;
    const id = this.factId(fact, actualScope);

    if (this.facts.has(id)) {
      return null; // Already exists
    }

    const stored: StoredFact = {
      id,
      fact,
      scope: actualScope,
      timestamp: Date.now(),
      source,
    };

    this.facts.set(id, stored);

    // Index by scope
    if (!this.byScope.has(actualScope)) {
      this.byScope.set(actualScope, new Set());
    }
    this.byScope.get(actualScope)!.add(id);

    // Index by key
    if (!this.byKey.has(fact[0])) {
      this.byKey.set(fact[0], new Set());
    }
    this.byKey.get(fact[0])!.add(id);

    // Index by value
    const vKey = this.valueKey(fact[1]);
    if (!this.byValue.has(vKey)) {
      this.byValue.set(vKey, new Set());
    }
    this.byValue.get(vKey)!.add(id);

    // Update scope hash
    this.updateScopeHash(actualScope);

    // Notify listeners
    for (const listener of this.listeners) {
      listener(stored);
    }

    return stored;
  }

  get(id: FactId): StoredFact | undefined {
    return this.facts.get(id);
  }

  has(fact: Fact, scope: Scope): boolean {
    return this.facts.has(this.factId(fact, scope));
  }

  retract(fact: Fact, scope: Scope): boolean {
    const id = this.factId(fact, scope);
    const stored = this.facts.get(id);
    if (!stored) return false;

    this.facts.delete(id);

    // Remove from scope index
    const scopeSet = this.byScope.get(scope);
    if (scopeSet) {
      scopeSet.delete(id);
      if (scopeSet.size === 0) this.byScope.delete(scope);
    }

    // Remove from key index
    const keySet = this.byKey.get(fact[0]);
    if (keySet) {
      keySet.delete(id);
      if (keySet.size === 0) this.byKey.delete(fact[0]);
    }

    // Remove from value index
    const vKey = this.valueKey(fact[1]);
    const valueSet = this.byValue.get(vKey);
    if (valueSet) {
      valueSet.delete(id);
      if (valueSet.size === 0) this.byValue.delete(vKey);
    }

    // Update scope hash
    this.updateScopeHash(scope);

    return true;
  }

  all(): StoredFact[] {
    return Array.from(this.facts.values());
  }

  allIds(): Set<FactId> {
    return new Set(this.facts.keys());
  }

  findByScope(scope: Scope): StoredFact[] {
    const ids = this.byScope.get(scope);
    if (!ids) return [];
    return Array.from(ids).map((id) => this.facts.get(id)!);
  }

  findByKey(key: string): StoredFact[] {
    const ids = this.byKey.get(key);
    if (!ids) return [];
    return Array.from(ids).map((id) => this.facts.get(id)!);
  }

  findByValue(value: Value): StoredFact[] {
    const ids = this.byValue.get(this.valueKey(value));
    if (!ids) return [];
    return Array.from(ids).map((id) => this.facts.get(id)!);
  }

  onAdd(listener: (fact: StoredFact) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // For sync - adds a pre-built StoredFact
  addStored(stored: StoredFact): boolean {
    if (this.facts.has(stored.id)) {
      return false;
    }
    this.facts.set(stored.id, stored);

    const fact = stored.fact;
    const scope = stored.scope;

    // Index by scope
    if (!this.byScope.has(scope)) {
      this.byScope.set(scope, new Set());
    }
    this.byScope.get(scope)!.add(stored.id);

    // Index by key
    if (!this.byKey.has(fact[0])) {
      this.byKey.set(fact[0], new Set());
    }
    this.byKey.get(fact[0])!.add(stored.id);

    // Index by value
    const vKey = this.valueKey(fact[1]);
    if (!this.byValue.has(vKey)) {
      this.byValue.set(vKey, new Set());
    }
    this.byValue.get(vKey)!.add(stored.id);

    // Update scope hash
    this.updateScopeHash(scope);

    for (const listener of this.listeners) {
      listener(stored);
    }

    return true;
  }

  // ============ Scope Hashing ============

  // Compute deterministic hash for a scope's facts
  private computeScopeHash(scope: Scope): string {
    const facts = this.findByScope(scope);
    if (facts.length === 0) return '00000000';

    // Sort facts deterministically by their ID
    const sorted = facts.map(f => f.id).sort();
    return simpleHash(sorted.join('|'));
  }

  // Update scope hash and notify if changed
  private updateScopeHash(scope: Scope): void {
    const newHash = this.computeScopeHash(scope);
    const meta = this.scopeMeta.get(scope);
    const oldHash = meta?.hash ?? '00000000';

    if (oldHash !== newHash) {
      // Update or create metadata
      if (meta) {
        meta.hash = newHash;
        meta.lastModified = Date.now();
      } else {
        this.scopeMeta.set(scope, {
          hash: newHash,
          visibleTo: new Set(),
          lastModified: Date.now(),
        });
      }

      // Notify hash change listeners
      for (const listener of this.hashChangeListeners) {
        listener(scope, oldHash, newHash);
      }
    }
  }

  // Get scope hash
  getScopeHash(scope: Scope): string {
    return this.scopeMeta.get(scope)?.hash ?? this.computeScopeHash(scope);
  }

  // Get scope metadata
  getScopeMeta(scope: Scope): ScopeMeta | undefined {
    return this.scopeMeta.get(scope);
  }

  // Listen for hash changes
  onHashChange(listener: (scope: Scope, oldHash: string, newHash: string) => void): () => void {
    this.hashChangeListeners.add(listener);
    return () => this.hashChangeListeners.delete(listener);
  }

  // ============ Scope Visibility ============

  // Make a scope visible to a peer
  setVisibleTo(scope: Scope, peerId: string): void {
    let meta = this.scopeMeta.get(scope);
    if (!meta) {
      meta = {
        hash: this.computeScopeHash(scope),
        visibleTo: new Set(),
        lastModified: Date.now(),
      };
      this.scopeMeta.set(scope, meta);
    }
    meta.visibleTo.add(peerId);
  }

  // Remove visibility
  removeVisibility(scope: Scope, peerId: string): void {
    const meta = this.scopeMeta.get(scope);
    if (meta) {
      meta.visibleTo.delete(peerId);
    }
  }

  // Check if scope is visible to peer
  isVisibleTo(scope: Scope, peerId: string): boolean {
    const meta = this.scopeMeta.get(scope);
    if (!meta) return false;
    return meta.visibleTo.has(peerId);
  }

  // Get all scopes visible to a peer
  getScopesVisibleTo(peerId: string): Scope[] {
    const visible: Scope[] = [];
    for (const [scope, meta] of this.scopeMeta) {
      if (meta.visibleTo.has(peerId)) {
        visible.push(scope);
      }
    }
    return visible;
  }

  // Get facts in scopes visible to a peer
  getFactsVisibleTo(peerId: string): StoredFact[] {
    const scopes = this.getScopesVisibleTo(peerId);
    const facts: StoredFact[] = [];
    for (const scope of scopes) {
      facts.push(...this.findByScope(scope));
    }
    return facts;
  }

  // ============ Scope Queries ============

  // Get all unique scopes
  getAllScopes(): Scope[] {
    return Array.from(this.byScope.keys());
  }

  // Get scopes with their hashes (for sync comparison)
  getScopeHashes(): Map<Scope, string> {
    const result = new Map<Scope, string>();
    for (const scope of this.byScope.keys()) {
      result.set(scope, this.getScopeHash(scope));
    }
    return result;
  }
}
