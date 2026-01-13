// Expression Types
//
// Expressions can be:
// - Literals: strings, numbers, booleans, null
// - Variables: ?x, ?name (for patterns)
// - Constructors: name, eq(x), add(a, b) - can take arguments
// - Scope references: @scopeId

export type Literal = string | number | boolean | null;

// Variable for pattern matching
export interface Variable {
  type: 'var';
  name: string;
}

// Constructor with optional arguments
export interface Constructor {
  type: 'constructor';
  name: string;
  args: Expression[];
}

// Reference to another scope
export interface ScopeRef {
  type: 'scope';
  id: string;
}

// Expression is one of these
export type Expression = Literal | Variable | Constructor | ScopeRef;

// Constructor definition - defines what arguments a constructor takes
export interface ConstructorDef {
  name: string;
  params: ParamDef[];  // Empty array for 0-ary constructors
  description?: string;
}

export interface ParamDef {
  name: string;
  type: 'any' | 'string' | 'number' | 'boolean' | 'scope' | 'expr';
}

// Check if value is a variable
export function isVariable(e: Expression): e is Variable {
  return typeof e === 'object' && e !== null && 'type' in e && e.type === 'var';
}

// Check if value is a constructor
export function isConstructor(e: Expression): e is Constructor {
  return typeof e === 'object' && e !== null && 'type' in e && e.type === 'constructor';
}

// Check if value is a scope reference
export function isScopeRef(e: Expression): e is ScopeRef {
  return typeof e === 'object' && e !== null && 'type' in e && e.type === 'scope';
}

// Check if value is a literal
export function isLiteral(e: Expression): e is Literal {
  return !isVariable(e) && !isConstructor(e) && !isScopeRef(e);
}

// Create helpers
export function variable(name: string): Variable {
  return { type: 'var', name };
}

export function constructor(name: string, ...args: Expression[]): Constructor {
  return { type: 'constructor', name, args };
}

export function scopeRef(id: string): ScopeRef {
  return { type: 'scope', id };
}

// Format expression for display
export function formatExpression(e: Expression): string {
  if (e === null) return 'null';
  if (typeof e === 'string') return `"${e}"`;
  if (typeof e === 'number' || typeof e === 'boolean') return String(e);

  if (isVariable(e)) return `?${e.name}`;

  if (isConstructor(e)) {
    if (e.args.length === 0) return e.name;
    const args = e.args.map(formatExpression).join(', ');
    return `${e.name}(${args})`;
  }

  if (isScopeRef(e)) return `@${e.id}`;

  return String(e);
}
