// Parser: String inputs → Interaction Net agents
//
// Handles:
// - Fact input: "key" + "value" → Fact agent
// - Query patterns: "name" or "?x" → Pattern with lit/var
// - Value types: strings, numbers, booleans, null

import type { Net, Value, Pattern, Agent } from './types';
import {
  createNet,
  createFact,
  createMatch,
  createJoin,
  createScope,
  createResult,
  connect,
  lit,
  varPat,
} from './net';

// ============ Value Parsing ============

// Parse a string input into a typed Value
export function parseValue(input: string): Value {
  const trimmed = input.trim();

  // null
  if (trimmed === 'null' || trimmed === '') {
    return null;
  }

  // boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // number (int or float)
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed.includes('.') ? parseFloat(trimmed) : parseInt(trimmed, 10);
  }

  // quoted string - remove quotes
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // unquoted string
  return trimmed;
}

// ============ Pattern Parsing ============

// Parse a pattern element: either a variable (?name) or a literal
export function parsePattern(input: string): Pattern {
  const trimmed = input.trim();

  // Variable: starts with ?
  if (trimmed.startsWith('?')) {
    const varName = trimmed.slice(1);
    if (varName.length === 0) {
      throw new Error('Variable name cannot be empty');
    }
    return varPat(varName);
  }

  // Literal value
  return lit(parseValue(trimmed));
}

// ============ Query String Parsing ============

// Parse a query string like "[name, ?x]" or "name: ?x"
export function parseQueryPattern(input: string): { key: Pattern; value: Pattern } {
  const trimmed = input.trim();

  // Format: [key, value]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    const parts = splitOnComma(inner);
    if (parts.length !== 2) {
      throw new Error('Pattern must have exactly 2 elements: [key, value]');
    }
    return {
      key: parsePattern(parts[0]),
      value: parsePattern(parts[1]),
    };
  }

  // Format: key: value
  if (trimmed.includes(':')) {
    const colonIdx = trimmed.indexOf(':');
    const key = trimmed.slice(0, colonIdx);
    const value = trimmed.slice(colonIdx + 1);
    return {
      key: parsePattern(key),
      value: parsePattern(value),
    };
  }

  // Format: just key (value is wildcard)
  return {
    key: parsePattern(trimmed),
    value: varPat('_'), // Anonymous variable
  };
}

// Split on comma, respecting quotes
function splitOnComma(s: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (const ch of s) {
    if ((ch === '"' || ch === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = ch;
      current += ch;
    } else if (ch === quoteChar && inQuotes) {
      inQuotes = false;
      current += ch;
    } else if (ch === ',' && !inQuotes) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

// ============ Full Query Parsing ============

// Parse multiple patterns joined with AND or newlines
// e.g., "[name, ?n] AND [age, ?a]" or "[name, ?n]\n[age, ?a]"
export function parseQuery(input: string): Array<{ key: Pattern; value: Pattern; scope?: Pattern }> {
  const patterns: Array<{ key: Pattern; value: Pattern; scope?: Pattern }> = [];

  // Split on AND or newlines
  const parts = input
    .split(/\s+AND\s+|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const part of parts) {
    // Check for scope prefix: @scope [pattern] or scope:[pattern]
    let scope: Pattern | undefined;
    let patternPart = part;

    // Format: @scopeName [key, value]
    const scopeMatch = part.match(/^@(\S+)\s+(.+)$/);
    if (scopeMatch) {
      scope = parsePattern(scopeMatch[1]);
      patternPart = scopeMatch[2];
    }

    // Format: scopeName:[key, value]
    const scopeColonMatch = part.match(/^([^[\]]+):\s*(\[.+\])$/);
    if (scopeColonMatch && !scopeMatch) {
      scope = parsePattern(scopeColonMatch[1]);
      patternPart = scopeColonMatch[2];
    }

    const parsed = parseQueryPattern(patternPart);
    patterns.push({ ...parsed, scope });
  }

  return patterns;
}

// ============ Net Construction from Parsed Query ============

export interface QueryBuildResult {
  net: Net;
  matches: Agent[];
  result: Agent;
}

// Build an interaction net from parsed patterns
export function buildQueryNet(
  patterns: Array<{ key: Pattern; value: Pattern; scope?: Pattern }>
): QueryBuildResult {
  const net = createNet();
  const matches: Agent[] = [];

  // Create result collector
  const result = createResult(net);

  if (patterns.length === 0) {
    return { net, matches, result };
  }

  if (patterns.length === 1) {
    // Single pattern - direct connection
    const p = patterns[0];
    const match = createMatch(net, p.key, p.value);
    matches.push(match);

    connect(
      net,
      match.ports.get('result_out')!.id,
      result.ports.get('collect')!.id
    );

    // Add scope constraint if specified
    if (p.scope) {
      const scopeAgent = createScope(
        net,
        p.scope.type === 'lit' ? (p.scope.value as string) : null
      );
      connect(
        net,
        scopeAgent.ports.get('principal')!.id,
        match.ports.get('scope_in')!.id
      );
    }
  } else {
    // Multiple patterns - use Join
    const join = createJoin(net, patterns.length);

    connect(
      net,
      join.ports.get('result_out')!.id,
      result.ports.get('collect')!.id
    );

    patterns.forEach((p, i) => {
      const match = createMatch(net, p.key, p.value);
      matches.push(match);

      connect(
        net,
        match.ports.get('result_out')!.id,
        join.ports.get(`in_${i}`)!.id
      );

      if (p.scope) {
        const scopeAgent = createScope(
          net,
          p.scope.type === 'lit' ? (p.scope.value as string) : null
        );
        connect(
          net,
          scopeAgent.ports.get('principal')!.id,
          match.ports.get('scope_in')!.id
        );
      }
    });
  }

  return { net, matches, result };
}

// ============ Fact Construction ============

export interface FactInput {
  key: string;
  value: string;
  scope: string;
}

// Build a Fact agent from string inputs
export function buildFactAgent(net: Net, input: FactInput): Agent {
  const key = input.key.trim();
  const value = parseValue(input.value);
  const scope = input.scope.trim();

  return createFact(net, key, value, scope);
}

// ============ UI Integration Helpers ============

// For the visual query builder with toggle buttons
export interface SlotConfig {
  mode: 'current' | 'any' | 'specific';
  value: string;  // Only used when mode === 'specific'
}

export interface VisualQueryConfig {
  scope: SlotConfig;
  key: SlotConfig;
  value: SlotConfig;
}

// Convert visual query builder config to pattern
export function visualConfigToPattern(
  config: VisualQueryConfig,
  currentScope: string
): { key: Pattern; value: Pattern; scope?: Pattern } {
  // Scope
  let scope: Pattern | undefined;
  switch (config.scope.mode) {
    case 'current':
      scope = lit(currentScope);
      break;
    case 'any':
      scope = varPat('scope');
      break;
    case 'specific':
      scope = lit(config.scope.value);
      break;
  }

  // Key
  let key: Pattern;
  switch (config.key.mode) {
    case 'current':
      throw new Error('Key cannot be "current"');
    case 'any':
      key = varPat('key');
      break;
    case 'specific':
      key = parsePattern(config.key.value);
      break;
  }

  // Value
  let value: Pattern;
  switch (config.value.mode) {
    case 'current':
      throw new Error('Value cannot be "current"');
    case 'any':
      value = varPat('value');
      break;
    case 'specific':
      value = parsePattern(config.value.value);
      break;
  }

  return { key, value, scope };
}

// ============ Example Usage ============

export function parseExample(): void {
  console.log('=== Parsing Examples ===\n');

  // Parse values
  console.log('parseValue("42"):', parseValue('42'));
  console.log('parseValue("3.14"):', parseValue('3.14'));
  console.log('parseValue("true"):', parseValue('true'));
  console.log('parseValue(\'"hello"\'):', parseValue('"hello"'));
  console.log('parseValue("hello"):', parseValue('hello'));
  console.log('');

  // Parse patterns
  console.log('parsePattern("name"):', parsePattern('name'));
  console.log('parsePattern("?x"):', parsePattern('?x'));
  console.log('parsePattern("42"):', parsePattern('42'));
  console.log('');

  // Parse query patterns
  console.log('parseQueryPattern("[name, ?n]"):', parseQueryPattern('[name, ?n]'));
  console.log('parseQueryPattern("age: 30"):', parseQueryPattern('age: 30'));
  console.log('');

  // Parse full query
  console.log('parseQuery("[name, ?n] AND [age, ?a]"):');
  console.log(parseQuery('[name, ?n] AND [age, ?a]'));
  console.log('');

  console.log('parseQuery("@user1 [name, ?n]"):');
  console.log(parseQuery('@user1 [name, ?n]'));
}
