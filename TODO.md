# Meshlang TODO / Design Goals

## Core Concepts

### Type Context System
The constructor that creates a scope determines what constructors are valid inside it.
- `allowedChildren`: list of constructor names allowed inside (undefined = all, [] = none/terminal)
- `requiredChildren`: list of constructor names that must be present
- Autocomplete filters suggestions based on parent constructor context

### Facts as Navigation Structure
Facts ARE the navigation structure. You navigate into facts like a file tree.
- Constructor-pattern keys (like `eq(symbol("x"))`) create navigable scopes
- The fact's ID becomes the child scope ID
- Different constructors available based on current context

### 2-Tuple Facts with Scope Metadata
- Facts are `[Key, Value]` with scope stored in metadata
- Scope is implicit (current actor/navigation position)
- Clean separation between fact data and scope tracking

---

## Type Definitions (Constructors)

### String Type (Linked List)
```
name
  └── string
        ├── data(charCode)  -- character code
        └── next(@restOfString)  -- continuation
```
- `name` allows only `string` inside
- `string` allows `data` and `next`, requires `data`
- Terminal constructors (data, next, symbol) have `allowedChildren: []`

### Peer/Group System
```
peer("peer-id")
  └── [connection UI appears when navigated into]

group("group-name")
  ├── peer("alice-id")
  ├── peer("bob-id")
  ├── consensus
  │     └── unanimous | majority | threshold(n)
  └── root
        └── [synced group scope - any constructors allowed]
```

---

## Implemented

### [x] Group Consensus System (Refactored)
- **Now expressed in the language itself** via stdlib constructors
- Scope hashing: deterministic content hash for each scope
- Scope visibility: control which peers can see which scopes
- Pull-based queries: peers request scopes by hash, only visible scopes returned
- Standard library: `src/stdlib/consensus.ts` defines group, proposal, vote constructors
- See `CONSENSUS_DESIGN.md` for full design

### [x] Type Context Filtering
- `allowedChildren` in ConstructorDef filters autocomplete
- Parent constructor detected from navigation path
- Autocomplete shows only valid constructors for context

### [x] Peer Connection via Constructor
- `peer("id")` constructor creates navigable scope
- Connection UI appears when navigated into peer scope

---

## Pending Implementation

### [ ] Interaction Nets as Query Semantics
- Queries as interaction patterns (Fact >< Match)
- Term graph for automatic memoization
- Pattern matching via interaction rules

### [ ] Expression System Completion
- Variables: `?x`, `?name` (for patterns)
- Constructors: `name`, `eq(symbol("x"))`, `add(a, b)`
- Scope references: `@scopeId`
- Full parser for complex expressions

### [ ] Type Validation
- Validate that required children are present before "closing" a scope
- Show warnings/errors for missing required constructors
- Type-check values against param types

### [ ] Context-Aware Value Autocomplete
- When inside `data()`, suggest character codes
- When inside `next()`, suggest scope references
- When inside `peer()`, suggest known peer IDs

---

## Architecture Notes

### Scope Navigation (DAG)
- Multiple parents allowed (DAG, not tree)
- Breadcrumb dropdowns for alternative parent paths
- `NavigationState` tracks current scope and path taken

### Files Structure
```
src/
  datalog/       -- Core fact storage and query
  expr/          -- Expression types, parsing, autocomplete
  scope/         -- Navigation and scope management
  inet/          -- Interaction net implementation (future: query semantics)
  ui/            -- Outliner, autocomplete UI, styles
  network/       -- P2P mesh networking
  identity/      -- Actor identity management
```

### Built-in Constructors (Current)
- `name`, `type`, `value` - Basic attributes
- `symbol(name)` - Create identifier
- `eq(expr)` - Equality/binding scope
- `lt(num)`, `gt(num)` - Comparisons
- `ref(target)` - Reference to scope
- `list(items)` - List container
- `peer(id)` - Peer connection
- `group(name)` - Group with synced scope
- `consensus`, `unanimous`, `majority`, `threshold(n)` - Consensus rules
- `root` - Group root scope
- `string`, `data(char)`, `next(rest)` - String type
- `item(value)` - List item

---

## Future Ideas

### Hierarchical Scopes
- Scope paths like `actor/project/task`
- Nested navigation with inheritance

### Expressions as Values
- Value type extended to include `{ op, args }` expressions
- Computed/derived values

### Types as Pattern Sets
- Query builder as foundation for defining types
- Types expressed as patterns that must match
