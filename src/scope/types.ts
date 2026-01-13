// Scope DAG Types
//
// Scopes form a directed acyclic graph (DAG), not a tree.
// A scope can have multiple parents, meaning there are multiple
// paths to reach the same scope.

export type ScopeId = string;

// Navigation path - the sequence of scopes traversed to reach current
export type ScopePath = ScopeId[];

// Scope relationships are stored as facts:
// - ["children", ["child1", "child2", ...]] in parent scope
// - ["parents", ["parent1", "parent2", ...]] in child scope
// This allows bidirectional traversal

export interface ScopeNode {
  id: ScopeId;
  name: string;           // Display name (from "name" fact)
  parents: ScopeId[];     // Can have multiple (DAG)
  children: ScopeId[];
}

export interface NavigationState {
  currentScope: ScopeId;
  path: ScopePath;        // How we got here (for breadcrumbs)
}

// When navigating, we track the path so breadcrumbs work
// If a scope has multiple parents, breadcrumb dropdown shows alternatives
