// Scope Navigation
//
// Handles DAG traversal and path tracking for scope navigation

import type { DatalogStore } from '../datalog/store';
import type { Value } from '../datalog/types';
import type { ScopeId, ScopeNode, NavigationState } from './types';

// ============ Reading Scope Structure from Facts ============

// Get the display name for a scope
export function getScopeName(store: DatalogStore, scopeId: ScopeId): string {
  const facts = store.findByScope(scopeId);
  const nameFact = facts.find((f) => f.fact[0] === 'name');
  return nameFact ? String(nameFact.fact[1]) : scopeId.slice(0, 8);
}

// Get parent scopes (a scope can have multiple parents in a DAG)
export function getParentScopes(store: DatalogStore, scopeId: ScopeId): ScopeId[] {
  const facts = store.findByScope(scopeId);
  const parentsFact = facts.find((f) => f.fact[0] === 'parents');

  if (!parentsFact) return [];

  const value = parentsFact.fact[1];
  if (Array.isArray(value)) {
    return value as ScopeId[];
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

// Get child scopes
export function getChildScopes(store: DatalogStore, scopeId: ScopeId): ScopeId[] {
  const facts = store.findByScope(scopeId);
  const childrenFact = facts.find((f) => f.fact[0] === 'children');

  if (!childrenFact) return [];

  const value = childrenFact.fact[1];
  if (Array.isArray(value)) {
    return value as ScopeId[];
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

// Build a ScopeNode from facts
export function getScopeNode(store: DatalogStore, scopeId: ScopeId): ScopeNode {
  return {
    id: scopeId,
    name: getScopeName(store, scopeId),
    parents: getParentScopes(store, scopeId),
    children: getChildScopes(store, scopeId),
  };
}

// ============ Navigation Actions ============

// Navigate into a child scope
export function navigateToChild(
  state: NavigationState,
  childId: ScopeId
): NavigationState {
  return {
    currentScope: childId,
    path: [...state.path, childId],
  };
}

// Navigate to parent (using the path we came from)
export function navigateToParent(state: NavigationState): NavigationState | null {
  if (state.path.length <= 1) {
    return null; // Already at root
  }

  const newPath = state.path.slice(0, -1);
  return {
    currentScope: newPath[newPath.length - 1],
    path: newPath,
  };
}

// Navigate to a specific point in the path (breadcrumb click)
export function navigateToPathIndex(
  state: NavigationState,
  index: number
): NavigationState {
  if (index < 0 || index >= state.path.length) {
    return state;
  }

  return {
    currentScope: state.path[index],
    path: state.path.slice(0, index + 1),
  };
}

// Switch to an alternative parent path
// When at a scope with multiple parents, this lets you view
// the breadcrumbs as if you came from a different parent
export function switchParentPath(
  state: NavigationState,
  pathIndex: number,      // Which breadcrumb to change
  newParentId: ScopeId    // The alternative parent to switch to
): NavigationState {
  if (pathIndex <= 0 || pathIndex >= state.path.length) {
    return state;
  }

  // Replace the parent at pathIndex-1 with newParentId
  const newPath = [...state.path];
  newPath[pathIndex - 1] = newParentId;

  return {
    currentScope: state.currentScope,
    path: newPath,
  };
}

// ============ Scope Manipulation ============

// Add a child scope to the current scope
export function addChildScope(
  store: DatalogStore,
  parentId: ScopeId,
  childId: ScopeId,
  source: string
): void {
  // Update parent's children list
  const currentChildren = getChildScopes(store, parentId);
  if (!currentChildren.includes(childId)) {
    const newChildren = [...currentChildren, childId];
    // Retract old children fact if exists
    const oldFact = store.findByScope(parentId).find((f) => f.fact[0] === 'children');
    if (oldFact) {
      store.retract(oldFact.fact, parentId);
    }
    store.add(['children', newChildren as unknown as Value], source, parentId);
  }

  // Update child's parents list
  const currentParents = getParentScopes(store, childId);
  if (!currentParents.includes(parentId)) {
    const newParents = [...currentParents, parentId];
    const oldFact = store.findByScope(childId).find((f) => f.fact[0] === 'parents');
    if (oldFact) {
      store.retract(oldFact.fact, childId);
    }
    store.add(['parents', newParents as unknown as Value], source, childId);
  }
}

// Create a new child scope under the current scope
export function createChildScope(
  store: DatalogStore,
  parentId: ScopeId,
  childName: string,
  source: string
): ScopeId {
  // Generate a new scope ID
  const childId = `scope_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Add name fact in the new scope
  store.add(['name', childName], source, childId);

  // Link parent and child
  addChildScope(store, parentId, childId, source);

  return childId;
}

// ============ Initial State ============

// Create initial navigation state starting at a root scope
export function createNavigationState(rootScope: ScopeId): NavigationState {
  return {
    currentScope: rootScope,
    path: [rootScope],
  };
}

// ============ Scope Discovery ============

// Find all root scopes (scopes with no parents)
// In practice, actor scopes are roots
export function findRootScopes(store: DatalogStore): ScopeId[] {
  const allScopes = new Set<ScopeId>();
  const nonRoots = new Set<ScopeId>();

  // Collect all scopes and identify those with parents
  for (const fact of store.all()) {
    allScopes.add(fact.scope);

    if (fact.fact[0] === 'parents') {
      const parents = fact.fact[1];
      if (Array.isArray(parents) && parents.length > 0) {
        nonRoots.add(fact.scope);
      } else if (typeof parents === 'string' && parents) {
        nonRoots.add(fact.scope);
      }
    }
  }

  // Root scopes are those without parents
  return Array.from(allScopes).filter((s) => !nonRoots.has(s));
}
