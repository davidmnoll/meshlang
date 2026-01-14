# Module System Design

## Core Insight
The context is composed of multiple modules from different sources.
Each module has its own read/write rules stored as facts within it.
Functions/behaviors are facts, not hardcoded TypeScript.

## Module Sources
- **localstorage** - Persisted locally, auto-accept writes
- **peer** - Facts from connected peers, their accept rules
- **filesystem** - Local files (future)
- **builtin** - Core constructors (minimal)

## Module Structure
```
module("name")
  ├── source: "localstorage" | "peer/xyz" | "builtin" | ...
  ├── readonly: false
  ├── accept
  │     └── [rules for accepting writes]
  ├── read
  │     └── [rules for what's visible]
  ├── export
  │     └── [constructors this module provides]
  └── content
        └── [the actual facts]
```

## Accept Rules (Examples)

### Auto-Accept (Local Storage)
```
accept
  └── always
```

### Consensus-Based (Group)
```
accept
  ├── requires
  │     └── unanimous(member, vote)
  └── timeout: 86400  // optional
```

### Read-Only (Builtin)
```
accept
  └── never
```

### Owner-Only
```
accept
  ├── requires
  │     └── from(owner)
  └── verify: signature
```

## How Writes Work

1. User adds fact to a module scope
2. System checks module's `accept` rule
3. If rule is satisfied → fact is added
4. If rule requires consensus → fact becomes proposal
5. If rule is `never` → write rejected

## How Reads Work

1. User queries a scope
2. System collects matching modules
3. Each module's `read` rule filters results
4. Combined results returned

## Questions

### What are the minimal primitives?

1. **Module registration** - Tell the system about a module and its source
2. **Rule evaluation** - Execute accept/read rules (needs interaction nets?)
3. **Source identity** - Know where facts came from

### How do modules compose?

Option A: Flat namespace with prefixes
```
stdlib/consensus/group(...)
local/my-project/task(...)
peer/alice/shared/doc(...)
```

Option B: Import/export
```
my-scope
  ├── import("stdlib/consensus")
  └── group("team")  ← uses imported constructors
```

### How are rules expressed?

Option A: Constructor patterns
```
accept
  ├── pattern: from(?author), sig(?s, ?author)
  └── verify: sig
```

Option B: Interaction net rules
```
accept
  └── rule
        ├── Match(from(?a), sig(?s, ?a))
        └── Action(Verify, Apply)
```

## Implementation Path

### Phase 1: Module Metadata (Current)
- Track source of facts (already have `source` in StoredFact)
- Add module-level metadata
- Manual rule checking

### Phase 2: Rule Facts
- Express accept/read rules as facts
- Pattern matching for rule evaluation
- Still manual application

### Phase 3: Automatic Rule Evaluation
- Interaction nets for pattern matching
- Rules fire automatically
- Full module isolation

## Standard Library as Module

The stdlib is just another module:
```
module("stdlib/consensus")
  ├── source: "builtin"
  ├── readonly: true
  ├── export
  │     ├── constructor: group
  │     ├── constructor: proposal
  │     └── constructor: vote
  └── content
        └── [constructor definitions as facts]
```

Users import it into their context:
```
my-actor
  └── import("stdlib/consensus")
```

This means constructors themselves are facts that can be queried!
