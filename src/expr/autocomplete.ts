// Autocomplete for Expressions
//
// Provides suggestions based on:
// - Keys that exist in current scope
// - Defined constructors (with their arity)
// - Available scopes (for scope references)

import type { DatalogStore } from '../datalog/store';
import type { ConstructorDef, ParamDef } from './types';
import { getPartialConstructor } from './parse';
import { STDLIB_CONSTRUCTORS } from '../stdlib/consensus';

export interface Suggestion {
  text: string;           // What to insert
  display: string;        // What to show in dropdown
  description?: string;   // Optional description
  type: 'key' | 'constructor' | 'scope' | 'value';
  completion?: string;    // Full completion (may differ from text)
}

// Get constructor definitions from scope
// Constructors are stored as facts: ["constructor", { name, params, description }]
export function getConstructorDefs(store: DatalogStore, scope: string): ConstructorDef[] {
  const facts = store.findByScope(scope);
  const defs: ConstructorDef[] = [];

  for (const fact of facts) {
    if (fact.fact[0] === 'constructor') {
      const value = fact.fact[1];
      if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        if (typeof obj.name === 'string') {
          defs.push({
            name: obj.name,
            params: (obj.params as ParamDef[]) || [],
            description: obj.description as string | undefined,
          });
        }
      } else if (typeof value === 'string') {
        // Simple 0-ary constructor
        defs.push({ name: value, params: [] });
      }
    }
  }

  return defs;
}

// Get all unique keys in scope
export function getKeysInScope(store: DatalogStore, scope: string): string[] {
  const facts = store.findByScope(scope);
  const keys = new Set<string>();

  for (const fact of facts) {
    keys.add(fact.fact[0]);
  }

  return Array.from(keys);
}

// Get all unique values in scope (for value suggestions)
export function getValuesInScope(store: DatalogStore, scope: string): Array<string | number | boolean> {
  const facts = store.findByScope(scope);
  const values = new Set<string>();
  const result: Array<string | number | boolean> = [];

  for (const fact of facts) {
    const v = fact.fact[1];
    if (v !== null) {
      const key = JSON.stringify(v);
      if (!values.has(key)) {
        values.add(key);
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          result.push(v);
        }
      }
    }
  }

  return result;
}

// Get available scopes (child scopes of current scope)
export function getAvailableScopes(store: DatalogStore, currentScope: string): Array<{ id: string; name: string }> {
  const facts = store.findByScope(currentScope);
  const childrenFact = facts.find((f) => f.fact[0] === 'children');

  if (!childrenFact) return [];

  const children = childrenFact.fact[1];
  if (!Array.isArray(children)) return [];

  return children.map((id: string) => {
    const scopeFacts = store.findByScope(id);
    const nameFact = scopeFacts.find((f) => f.fact[0] === 'name');
    const name = nameFact ? String(nameFact.fact[1]) : id.slice(0, 8);
    return { id, name };
  });
}

// Get a constructor definition by name
export function getConstructorByName(name: string): ConstructorDef | undefined {
  return ALL_CONSTRUCTORS.find((c) => c.name === name);
}

// Extract constructor name from a key like "name" or "eq(symbol("x"))"
export function extractConstructorName(key: string): string | undefined {
  // Try constructor with args: name(...)
  const match = key.match(/^(\w+)\(/);
  if (match) return match[1];

  // Try 0-ary constructor: just the name
  const def = ALL_CONSTRUCTORS.find((c) => c.name === key && c.params.length === 0);
  if (def) return key;

  return undefined;
}

// Generate suggestions for key input
// parentConstructorName: the constructor that created the current scope (filters what's allowed)
export function suggestKeys(
  store: DatalogStore,
  scope: string,
  input: string,
  parentConstructorName?: string
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const lower = input.toLowerCase();

  // Get parent constructor's allowed children (if any)
  let allowedChildren: string[] | undefined;
  if (parentConstructorName) {
    const parentDef = getConstructorByName(parentConstructorName);
    if (parentDef) {
      allowedChildren = parentDef.allowedChildren;
    }
  }

  // If allowedChildren is empty array, no constructors allowed (terminal scope)
  const isTerminal = allowedChildren !== undefined && allowedChildren.length === 0;

  // 1. Keys in scope (always show existing keys)
  const keys = getKeysInScope(store, scope);
  for (const key of keys) {
    if (key.toLowerCase().includes(lower)) {
      suggestions.push({
        text: key,
        display: key,
        type: 'key',
      });
    }
  }

  // 2. Constructors - filtered by parent context
  if (!isTerminal) {
    const storeConstructors = getConstructorDefs(store, scope);
    const allConstructors = [...ALL_CONSTRUCTORS, ...storeConstructors];
    const seenNames = new Set<string>();

    for (const def of allConstructors) {
      if (seenNames.has(def.name)) continue;
      seenNames.add(def.name);

      // Filter by allowed children if specified
      if (allowedChildren !== undefined && !allowedChildren.includes(def.name)) {
        continue;
      }

      if (def.name.toLowerCase().includes(lower)) {
        if (def.params.length === 0) {
          suggestions.push({
            text: def.name,
            display: def.name,
            description: def.description,
            type: 'constructor',
          });
        } else {
          const params = def.params.map((p) => p.name).join(', ');
          suggestions.push({
            text: `${def.name}(`,
            display: `${def.name}(${params})`,
            description: def.description,
            type: 'constructor',
            completion: `${def.name}()`,
          });
        }
      }
    }
  }

  // 3. Check if we're inside a constructor call
  const partial = getPartialConstructor(input);
  if (partial) {
    const allConstructors = [...ALL_CONSTRUCTORS, ...getConstructorDefs(store, scope)];
    const def = allConstructors.find((c) => c.name === partial.name);
    if (def && partial.argCount < def.params.length) {
      const param = def.params[partial.argCount];
      // Suggest based on param type
      suggestions.push({
        text: '',
        display: `${param.name}: ${param.type}`,
        description: `Argument ${partial.argCount + 1} of ${def.name}`,
        type: 'constructor',
      });
    }
  }

  return suggestions;
}

// Generate suggestions for value input
export function suggestValues(
  store: DatalogStore,
  scope: string,
  input: string,
  forKey?: string
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const lower = input.toLowerCase();

  // 1. Existing values for this key
  if (forKey) {
    const facts = store.findByScope(scope);
    const seenValues = new Set<string>();

    for (const fact of facts) {
      if (fact.fact[0] === forKey) {
        const v = fact.fact[1];
        const display = v === null ? 'null' : typeof v === 'string' ? v : JSON.stringify(v);
        if (!seenValues.has(display) && display.toLowerCase().includes(lower)) {
          seenValues.add(display);
          suggestions.push({
            text: display,
            display,
            type: 'value',
          });
        }
      }
    }
  }

  // 2. All values in scope
  const values = getValuesInScope(store, scope);
  for (const v of values) {
    const display = typeof v === 'string' ? v : String(v);
    if (display.toLowerCase().includes(lower)) {
      const exists = suggestions.some((s) => s.display === display);
      if (!exists) {
        suggestions.push({
          text: display,
          display,
          type: 'value',
        });
      }
    }
  }

  // 3. Scope references
  if (input.startsWith('@') || input === '') {
    const scopes = getAvailableScopes(store, scope);
    for (const s of scopes) {
      const text = `@${s.id}`;
      if (text.toLowerCase().includes(lower)) {
        suggestions.push({
          text,
          display: `@${s.name}`,
          description: `Scope: ${s.id.slice(0, 8)}`,
          type: 'scope',
        });
      }
    }
  }

  // 4. Boolean/null suggestions
  if ('true'.includes(lower)) {
    suggestions.push({ text: 'true', display: 'true', type: 'value' });
  }
  if ('false'.includes(lower)) {
    suggestions.push({ text: 'false', display: 'false', type: 'value' });
  }
  if ('null'.includes(lower)) {
    suggestions.push({ text: 'null', display: 'null', type: 'value' });
  }

  return suggestions;
}

// Built-in constructors with type context rules
// allowedChildren: undefined = all allowed, [] = none (terminal), [...] = specific list
export const BUILTIN_CONSTRUCTORS: ConstructorDef[] = [
  // Top-level constructors (available at root/actor scope)
  { name: 'name', params: [], description: 'Name attribute', allowedChildren: ['string'] },
  { name: 'type', params: [], description: 'Type attribute', allowedChildren: ['symbol'] },
  { name: 'value', params: [], description: 'Value attribute' },  // allows any
  { name: 'symbol', params: [{ name: 'name', type: 'string' }], description: 'Create a symbol', allowedChildren: [] },
  { name: 'eq', params: [{ name: 'expr', type: 'any' }], description: 'Equality/binding scope' },  // allows any
  { name: 'lt', params: [{ name: 'num', type: 'number' }], description: 'Less than', allowedChildren: [] },
  { name: 'gt', params: [{ name: 'num', type: 'number' }], description: 'Greater than', allowedChildren: [] },
  { name: 'ref', params: [{ name: 'target', type: 'any' }], description: 'Reference to scope', allowedChildren: [] },
  { name: 'list', params: [{ name: 'items', type: 'any' }], description: 'List of items', allowedChildren: ['item', 'next'] },
  { name: 'peer', params: [{ name: 'id', type: 'string' }], description: 'Peer connection', allowedChildren: [] },
  { name: 'group', params: [{ name: 'name', type: 'string' }], description: 'Group with synced scope', allowedChildren: ['peer', 'consensus', 'root'] },
  { name: 'consensus', params: [], description: 'Consensus rule (default: unanimous)', allowedChildren: ['unanimous', 'majority', 'threshold'] },
  { name: 'unanimous', params: [], description: 'Require all peers to agree', allowedChildren: [] },
  { name: 'majority', params: [], description: 'Require majority to agree', allowedChildren: [] },
  { name: 'threshold', params: [{ name: 'n', type: 'number' }], description: 'Require n peers to agree', allowedChildren: [] },
  { name: 'root', params: [], description: 'Group root scope (synced data)', allowedChildren: undefined },  // allows any

  // String type: linked list of characters
  { name: 'string', params: [], description: 'String value', allowedChildren: ['data', 'next'], requiredChildren: ['data'] },
  { name: 'data', params: [{ name: 'char', type: 'number' }], description: 'Character code', allowedChildren: [] },
  { name: 'next', params: [{ name: 'rest', type: 'scope' }], description: 'Rest of string/list', allowedChildren: [] },

  // List items
  { name: 'item', params: [{ name: 'value', type: 'any' }], description: 'List item', allowedChildren: [] },
];

// All available constructors (builtins + stdlib)
export const ALL_CONSTRUCTORS: ConstructorDef[] = [
  ...BUILTIN_CONSTRUCTORS,
  ...STDLIB_CONSTRUCTORS,
];

// Initialize scope with built-in constructors
export function initBuiltinConstructors(store: DatalogStore, scope: string, source: string): void {
  for (const def of ALL_CONSTRUCTORS) {
    store.add(['constructor', def as unknown as string], source, scope);
  }
}
