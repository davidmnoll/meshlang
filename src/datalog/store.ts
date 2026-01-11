import type { Fact, FactId, StoredFact, Value, Scope } from './types';

export class DatalogStore {
  private facts: Map<FactId, StoredFact> = new Map();
  private byScope: Map<string, Set<FactId>> = new Map();
  private byKey: Map<string, Set<FactId>> = new Map();
  private byValue: Map<string, Set<FactId>> = new Map();
  private listeners: Set<(fact: StoredFact) => void> = new Set();

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

    for (const listener of this.listeners) {
      listener(stored);
    }

    return true;
  }
}
