# Meshlang Specification

**Version: 0.1 (Draft)**

This document specifies the semantics of Meshlang, independent of implementation details.

---

## 1. Core Concepts

### 1.1 Facts
A **fact** is a 2-tuple `[Key, Value]` that exists within a scope.

- **Key**: A string, optionally a constructor expression (e.g., `name`, `eq(symbol("x"))`)
- **Value**: A primitive (string, number, boolean, null) or a structured value

Facts are the fundamental unit of data. Everything in the system is expressed as facts.

### 1.2 Scopes
A **scope** is a namespace that contains facts. Scopes form a DAG (directed acyclic graph).

Properties of a scope:
- **Identity**: Content-addressed hash of its facts
- **Parent(s)**: Zero or more parent scopes (DAG allows multiple parents)
- **Children**: Scopes reachable by navigating into constructor-keyed facts

When you add a fact with a constructor key (e.g., `group("team")`), that fact's ID becomes a navigable child scope.

### 1.3 Constructors
A **constructor** defines a pattern for keys and what's valid inside the scope it creates.

```
ConstructorDef:
  name: string
  params: ParamDef[]
  allowedChildren?: string[]   // undefined = all, [] = none (terminal)
  requiredChildren?: string[]  // must be present for scope to be "complete"
```

The constructor that creates a scope determines the **type context** for that scope.

### 1.4 Expressions
An **expression** is a value that can appear in keys or values:

- **Literal**: `"hello"`, `42`, `true`, `null`
- **Variable**: `?x`, `?name` (for patterns/queries)
- **Constructor**: `name`, `eq(symbol("x"))`, `list(a, b, c)`
- **Scope Reference**: `@scopeId` (reference to another scope)

---

## 2. Type System

### 2.1 Type Context
The type of a scope is determined by the constructor that created it.

```
parent-scope/
  └── group("team")     ← constructor key
        └── [child scope with type context "group"]
```

Within a `group` scope, only constructors allowed by `group.allowedChildren` are valid.

### 2.2 Type Validation
A scope is **complete** when all `requiredChildren` constructors are present.
A scope is **valid** when all facts use allowed constructors.

### 2.3 Terminal Scopes
A scope with `allowedChildren: []` is terminal - no constructors can be added inside.

---

## 3. Module System

### 3.1 What is a Module?
A **module** is a scope with metadata that defines:
- **Source**: Where the module comes from (local, peer, builtin, filesystem)
- **Accept Rule**: How write proposals are handled
- **Read Rule**: What's visible to readers
- **Exports**: Constructors and values provided to importers

### 3.2 Module Sources

| Source | Description | Typical Accept Rule |
|--------|-------------|---------------------|
| `builtin` | Core language primitives | `never` (read-only) |
| `localstorage` | Persisted locally | `always` (auto-accept) |
| `peer/[id]` | From a connected peer | Peer's rules |
| `group/[id]` | Shared group scope | Consensus-based |
| `filesystem` | Local files (future) | `always` or `owner` |

### 3.3 Accept Rules
Accept rules determine how writes are processed:

- `always` - Writes are immediately applied
- `never` - Writes are rejected (read-only)
- `owner(pubkey)` - Only owner can write
- `consensus(rule)` - Requires group agreement
- `[custom]` - User-defined rules (future)

### 3.4 Module Composition
The user's context is composed of multiple modules. When querying:
1. Query is sent to all relevant modules
2. Each module filters results by its read rule
3. Results are merged

When writing:
1. Write targets a specific module/scope
2. Module's accept rule is evaluated
3. If accepted → applied; if consensus → becomes proposal; if rejected → error

---

## 4. Consensus

### 4.1 Groups
A **group** is a module shared among multiple peers with consensus-based writes.

```
group("name")
  ├── member("alice-pubkey")
  ├── member("bob-pubkey")
  ├── rule
  │     └── unanimous | majority | threshold(n)
  └── state
        └── [shared facts]
```

### 4.2 Proposals
A **proposal** is a suggested change to group state.

```
proposal("id")
  ├── from("author-pubkey")
  ├── base("current-state-hash")  ← must match for proposal to be valid
  ├── change
  │     └── [proposed facts]
  └── votes
        └── vote("voter-pubkey")
              ├── approve(true|false)
              └── sig("signature")
```

### 4.3 Consensus Rules

| Rule | Requirement |
|------|-------------|
| `unanimous` | All members must approve |
| `majority` | >50% must approve |
| `threshold(n)` | At least n must approve |

### 4.4 State Transitions
When consensus is reached:
1. `change` facts are applied to `state`
2. State hash updates (automatic from content)
3. Proposal is archived or removed

---

## 5. Network Model

### 5.1 Peers
A **peer** is another node in the network, identified by public key.

```
peer("peer-id")
  ├── outbox     ← facts to send to this peer
  └── inbox      ← facts received from this peer
```

### 5.2 Visibility
Scope **visibility** determines which peers can see which scopes.

- A scope is visible to a peer if explicitly marked or by rule
- The mesh only syncs visible scopes to each peer
- Visibility is not transitive (A visible to B, B visible to C ≠ A visible to C)

### 5.3 Sync Protocol
Sync is **pull-based** and **hash-diffed**:

1. Peer A sends scope hashes to Peer B
2. Peer B compares with local hashes
3. Peer B requests scopes where hashes differ
4. Peer A responds with facts (only for visible scopes)

### 5.4 Message Types

| Message | Purpose |
|---------|---------|
| `scope-hashes` | Broadcast current scope hashes |
| `scope-query` | Request specific scopes by hash |
| `scope-response` | Return scope facts |

---

## 6. Query Language

### 6.1 Patterns
A **pattern** matches facts in a scope.

```
[?key, ?value]           ← match any fact, bind key and value
["name", ?n]             ← match facts with key "name"
[?k, 42]                 ← match facts with value 42
["type", "task"]         ← match exact fact
```

### 6.2 Query Scope
Queries are scoped:
- Default: current scope only
- Cross-scope: requires explicit scope pattern or visibility

### 6.3 Bindings
Query results are **bindings** - maps from variable names to matched values.

```
Query: ["status", ?s]
Results: [{ s: "active" }, { s: "pending" }]
```

---

## 7. Standard Library

### 7.1 Core Constructors (Builtin)
Minimal set that cannot be expressed as facts:

| Constructor | Purpose |
|-------------|---------|
| `name` | Name attribute |
| `type` | Type attribute |
| `value` | Value attribute |
| `symbol(s)` | Create identifier |
| `eq(expr)` | Equality/binding |
| `ref(target)` | Reference to scope |

### 7.2 Consensus Constructors (stdlib/consensus)
Expressed as facts, importable:

| Constructor | Purpose |
|-------------|---------|
| `group(name)` | Consensus group |
| `member(pubkey)` | Group member |
| `proposal(id)` | Change proposal |
| `vote(voter)` | Vote on proposal |
| `outbox` | Peer message outbox |
| `inbox` | Peer message inbox |

### 7.3 Data Type Constructors (stdlib/types)
For structured data:

| Constructor | Purpose |
|-------------|---------|
| `string` | String value (linked list) |
| `data(char)` | Character code |
| `next(rest)` | Continuation |
| `list` | List container |
| `item(value)` | List item |

---

## 8. Primitives

### 8.1 Minimal Primitives Required

These cannot be expressed as facts and must be implemented:

1. **Fact storage** - Add, retract, query facts
2. **Scope hashing** - Deterministic content hash
3. **Visibility** - Mark scopes visible to peers
4. **Network transport** - Send/receive messages

### 8.2 Future Primitives

May be needed for full functionality:

1. **Cryptographic signing** - `sign(data)` → signature
2. **Signature verification** - `verify(sig, pubkey)` → boolean
3. **Rule evaluation** - Execute pattern-based rules (interaction nets?)

---

## 9. Open Questions

### 9.1 Rule Execution
How are accept/read rules evaluated?
- Manual checking (current)
- Datalog evaluation
- Interaction nets
- Some hybrid

### 9.2 Module Import Semantics
When you import a module:
- Are constructors copied or referenced?
- Can you override imported constructors?
- How are version conflicts resolved?

### 9.3 Time and Ordering
- Do facts have timestamps?
- How are concurrent edits resolved?
- Is there a canonical ordering?

### 9.4 Garbage Collection
- When are unused scopes cleaned up?
- How do we handle orphaned proposals?

---

## 10. Examples

### 10.1 Create a Todo List
```
Navigate to actor scope
Add: group("my-todos")
Navigate into group
Add: member("[my-pubkey]")
Add: rule
Navigate into rule, add: always
Navigate back
Add: state
Navigate into state
Add: task("buy groceries")
Navigate into task
Add: status → "pending"
Add: priority → 1
```

### 10.2 Share with a Peer
```
Navigate to peer("bob-id")
Add: outbox
Navigate into outbox
Add: share
Navigate into share
Add: ref(@group("my-todos"))
Add: permission → "read"
```

### 10.3 Collaborative Edit
```
In group("team-project") with members alice, bob:

Alice proposes:
Add: proposal("add-task")
Navigate into proposal
Add: from("alice-pubkey")
Add: base("[current-state-hash]")
Add: change
Navigate into change
Add: task("new feature")

Bob votes:
Navigate to proposal("add-task")
Add: vote("bob-pubkey")
Navigate into vote
Add: approve(true)

Consensus reached → change applied to state
```

---

## Appendix A: Grammar (Informal)

```
Fact        := [Key, Value]
Key         := String | Constructor
Value       := Literal | Constructor | ScopeRef
Literal     := String | Number | Boolean | Null
Constructor := Name | Name "(" Args ")"
Args        := Expression ("," Expression)*
Expression  := Literal | Variable | Constructor | ScopeRef
Variable    := "?" Name
ScopeRef    := "@" ScopeId
```

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| Fact | A key-value pair in a scope |
| Scope | A namespace containing facts |
| Constructor | A pattern for creating scopes with type context |
| Module | A scope with source/accept/read metadata |
| Peer | Another node in the network |
| Proposal | A suggested change requiring consensus |
| Binding | A variable→value mapping from a query |
| Visibility | Which peers can see a scope |
