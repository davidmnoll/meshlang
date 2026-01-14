# Consensus in the Language

**Status: Phase 1 Implemented**

## Goal
Express group consensus entirely within the language using facts and constructors, exposing minimal primitives.

## Implemented (Phase 1)

### Scope Hashing
- Each scope has a deterministic content hash computed from its facts
- Hash is internal metadata, not exposed as a constructor
- Hash changes trigger events for observers

### Scope Visibility
- `store.setVisibleTo(scope, peerId)` - make scope visible to peer
- `store.isVisibleTo(scope, peerId)` - check visibility
- `store.getFactsVisibleTo(peerId)` - get all facts visible to a peer

### Pull-Based Queries
- Peers query each other for scopes by hash
- Only scopes with differing hashes are transferred
- Only visible scopes are returned

### Standard Library Constructors (`src/stdlib/consensus.ts`)
```
group(name)           - Group with members and state
  ├── member(pubkey)  - Group member
  ├── rule            - Consensus rule
  ├── state           - Content-addressed state
  └── proposal(id)    - Proposed change
        ├── from(pubkey)
        ├── base(hash)    - Must match current state
        ├── change        - The proposed facts
        └── vote(voter)
              ├── approve(bool)
              └── sig(signature)

peer(id)
  ├── outbox          - Messages to send to peer
  └── inbox           - Messages received from peer
```

## Minimal Primitives

### Currently Needed:
1. **Scope hashing** - Automatic, internal to store
2. **Visibility control** - `setVisibleTo`, `isVisibleTo`
3. **Pull queries** - `scope-query`, `scope-response` messages

### Future (Phase 2):
1. `sign(data)` - Cryptographic signature primitive
2. `verify(sig, pubkey)` - Signature verification

## Consensus Flow (Manual - Phase 1)

### 1. Create Group
```
Navigate to your actor scope
Add: group("team-name")
Navigate into the group
Add: member("alice-pubkey")
Add: member("bob-pubkey")
Add: rule
Navigate into rule, add: unanimous
Navigate back, add: state (the shared state)
```

### 2. Create Proposal
```
In the group scope:
Add: proposal("prop-123")
Navigate into proposal
Add: from("my-pubkey")
Add: base("current-state-hash")  ← get from state scope
Add: change
Navigate into change, add the proposed facts
```

### 3. Send to Peers
```
Navigate to peer("bob-id")
Add: outbox
Navigate into outbox
Add the proposal facts (or reference)
```
The mesh syncs outbox to Bob based on visibility.

### 4. Vote
```
Bob sees proposal in his inbox
Creates vote in the proposal scope:
Add: vote("bob-pubkey")
Navigate into vote
Add: approve(true)
```

### 5. Check Consensus
```
Manually check all votes are present
If unanimous approved, apply change to state
Update state hash (automatic from content)
```

## Phase 2: Automatic Rules

Rules could be expressed as facts that trigger on patterns:
```
rule("apply-unanimous")
  when
    proposal(?p)
    all member(?m) has vote(?m, ?p, true)
  then
    apply-to-state(?p.change)
```

This requires interaction net rules or Datalog evaluation.

## Files

- `src/datalog/store.ts` - Scope hashing and visibility
- `src/network/protocol.ts` - Scope query messages
- `src/network/mesh.ts` - Pull-based sync handlers
- `src/stdlib/consensus.ts` - Standard library constructors
- `src/expr/autocomplete.ts` - Includes stdlib in suggestions
