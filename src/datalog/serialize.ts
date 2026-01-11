import type { StoredFact, Fact, Value } from './types';

// New 2-tuple format
export interface SerializedFact {
  id: string;
  k: string;    // key
  v: Value;     // value
  sc: string;   // scope
  t: number;    // timestamp
  s: string;    // source
}

// Legacy 3-tuple format (for migration)
interface LegacySerializedFact {
  id: string;
  e: string;    // entity (becomes scope)
  a: string;    // attribute (becomes key)
  v: Value;     // value
  t: number;    // timestamp
  s: string;    // source
}

export function serializeFact(stored: StoredFact): SerializedFact {
  return {
    id: stored.id,
    k: stored.fact[0],
    v: stored.fact[1],
    sc: stored.scope,
    t: stored.timestamp,
    s: stored.source,
  };
}

export function deserializeFact(data: SerializedFact | LegacySerializedFact): StoredFact {
  // Check for legacy format (has 'e' and 'a' fields)
  if ('e' in data && 'a' in data) {
    const legacy = data as LegacySerializedFact;
    return {
      id: legacy.id,
      fact: [legacy.a, legacy.v] as Fact,  // attribute -> key, value stays
      scope: legacy.e,                       // entity -> scope
      timestamp: legacy.t,
      source: legacy.s,
    };
  }

  // New format
  const modern = data as SerializedFact;
  return {
    id: modern.id,
    fact: [modern.k, modern.v] as Fact,
    scope: modern.sc,
    timestamp: modern.t,
    source: modern.s,
  };
}

export function serializeFacts(facts: StoredFact[]): string {
  return JSON.stringify(facts.map(serializeFact));
}

export function deserializeFacts(json: string): StoredFact[] {
  const data = JSON.parse(json) as (SerializedFact | LegacySerializedFact)[];
  return data.map(deserializeFact);
}
