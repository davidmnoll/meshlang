<LeftMouWebRTC Browser Mesh: Group Messaging + Governance + Group Signatures
Objective

Implement a browser-based WebRTC mesh network that supports:

Content-addressed replication across mesh nodes (DHT/gossip-like).

Actors that can reconnect anywhere and rehydrate state from peers.

Groups whose membership, messaging, and governance are managed at the actor layer, insulated from mesh details.

Governance defined by rules like “if ≥10% approve, trigger action X.”

External authorization: third parties should see a single group signature under a single group public key and not need to understand governance (e.g., 10%).

This spec focuses on architecture, data models, and protocols. It does not require a blockchain.

High-Level Architecture
Layers

A. Mesh Node Layer (browser runtime per tab/device)

WebRTC peer connections and DataChannels.

Message propagation, peer scoring/priority, rate limits.

Content-addressed block store (in-memory + IndexedDB persistence).

Content fetch (“want/have”), replication, and delivery.

B. Actor Layer (logical identity)

Identity keys, actor state, feeds/logs, groups.

Decides what to accept, merge, decrypt.

Group governance, voting, membership epochs.

Produces/requests group authorization signatures.

Key constraint: actor logic should not assume stable peer connections; it should function under churn.

Cryptographic Primitives (Browser Practicality)
Identity keys

Use Ed25519 for signatures and X25519 for ECDH if possible (good modern defaults).

In-browser: implement using a vetted JS/WASM library (e.g., noble-curves + noble-ed25519, or tweetnacl).

Store private keys in IndexedDB (encrypted at rest with a user passphrase-derived key if needed).

Content encryption

Use symmetric AEAD (AES-GCM or ChaCha20-Poly1305).

WebCrypto supports AES-GCM natively; ChaCha20-Poly1305 typically via libsodium/noble.

Group messaging confidentiality (MVP)

Do not implement full MLS initially.

Implement “Tree-based group keying (MLS-inspired)” later. For MVP:

Maintain a group epoch key K_epoch for encrypting group messages.

On membership change, rotate to a new epoch key and distribute it to members using per-member envelope encryption (E2EE).

Group authorization (single signature under group PK)

Implement a committee-based threshold signing service:

The group has a single external public key PK_G.

A small committee holds shares of the signing secret and can produce a standard signature that verifies under PK_G.

The committee only signs after internal governance conditions are satisfied (votes collected, counted).

MVP approach: You can start with a committee that holds an ordinary private key in split trust (or a single coordinator key) to unblock integration. Then replace with true threshold signing once the protocol and data model are stable.

Target approach: threshold signatures (e.g., FROST for Schnorr or threshold BLS). The signing output must be verifiable with a single PK_G.

Core Data Model (Content-Addressed Objects)

All objects are stored as blocks in the mesh block store.

Block format

cid = hash(bytes) (e.g., SHA-256 multihash style)

Each block includes:

type (string)

version

payload (typed JSON / CBOR)

sig? optional signature at object level (recommended for governance objects)

Use a canonical serialization (CBOR with deterministic encoding is strongly recommended) to ensure stable CIDs.

Actor Identity

ActorID = hash(publicSigningKey) (or the public key itself if you prefer).

Actor profile root:

ActorProfile { actorId, signingPubKey, encryptionPubKey, metadata }

Actor Feed (append-only log)

Used to announce state updates, contacts, group activity.

FeedEntry { actorId, seq, prevCid, timestamp, payloadCids[], signature }

This supports rehydration and replication: peers fetch entries by seq/cid.

Group Objects

Group identity:

GroupID (random 256-bit) or derived from “genesis group entry cid.”

Group state is managed by epochs:

GroupEpochState { groupId, epoch, membersRoot, committeeRoot, policyRoot, messageKeyInfo, signature? }

Where:

membersRoot references a membership set object.

committeeRoot references committee membership/shares config.

policyRoot references governance policies.

messageKeyInfo references encryption key material distribution and epoch key metadata.

Proposals and Votes

Proposal:

Proposal { proposalId, groupId, epoch, actionType, actionPayloadCid, createdBy, createdAt, expiresAt }

proposalId = hash(Proposal canonical bytes)

Vote:

Vote { proposalId, groupId, epoch, voterActorId, voteValue, signature }

Signature is by voter’s identity signing key over hash(proposalId || voteValue || epoch).

Group Authorization Attestation

This is what outsiders check.

Attestation:

GroupAttestation { groupId, epoch, proposalId, signedMessageHash, groupSignature, issuedAt }

groupSignature verifies under group public key PK_G:

Verify(PK_G, signedMessageHash, groupSignature) == true

Outsiders do not need to know voting rules.

Protocols
1) Mesh Replication Protocol
Peer connection

WebRTC DataChannel per peer (reliable ordered initially; later support unordered for gossip).

Basic handshake: exchange node ID, supported protocol versions, rate limits.

Block exchange

Use a simple want/have protocol:

HAVE { cids: [cid...] }

WANT { cids: [cid...] }

BLOCK { cid, bytes }

Peers periodically announce:

recent CIDs they acquired,

feed heads they know about,

group epochs they can serve.

Storage constraints

TTL and size caps (per peer and global).

Persist critical objects in IndexedDB:

actor keys

actor feed heads and known feed entries

group epoch states

membership snapshots

votes and attestations

2) Actor Login / Rehydration

On login:

Load local cached state (IndexedDB).

Connect to any mesh node (your own tab is also a node).

Query peers for:

your actor feed head (latest seq / head CID)

group epoch states for groups you belong to

Fetch missing feed entries and referenced blocks.

Reconstruct actor/group state.

This uses the same replication path as message delivery.

3) Global “Rendezvous” vs Group Channels

Implement a global topic used only for:

actor presence announcements,

group invitations,

encrypted envelopes to bootstrap smaller groups.

Do not place plaintext messages there.

Global message object:

GlobalEnvelope { toTag, ciphertext, ttl, pow?, signature? }

toTag enables recipients to filter quickly without revealing identity (MVP can be hash(actorPubKey||epoch)).

4) Group Messaging

Group message object:

GroupMessage { groupId, epoch, authorActorId, ciphertext, nonce, aad, signature? }

Encryption:

ciphertext = AEAD_Encrypt(K_epoch, plaintext, aad)

aad includes (groupId, epoch, authorActorId, messageCid?)

Replication:

messages propagate like any other block.

only members can decrypt using K_epoch.

Key distribution (MVP):

When a member joins or epoch rotates, distribute K_epoch to each member via a per-member encrypted envelope:

KeyEnvelope { groupId, epoch, recipientActorId, encryptedKeyMaterial }

Later enhancement:

Replace with TreeKEM/MLS-like group key update.

5) Governance: Voting and Threshold Trigger

Policy object:

Policy { groupId, epoch, rules: [Rule...] }

Example Rule: { type: "fractionalApproval", threshold: 0.10, eligible: "members", actionTypes: ["TRIGGER_X", "REMOVE_MEMBER"] }

Vote collection:

votes are blocks; any node can gossip them.

evaluator (any participant) can compute whether threshold is met:

fetch membership snapshot for epoch,

verify voter is member,

dedupe voter IDs,

check fraction >= threshold.

When threshold met:

request group attestation signature from committee service.

6) Group Attestation Signing (Committee)
Committee concept

A small set of actors designated by group governance.

They run a signing service that outputs a group signature under PK_G.

Workflow

A member proposes action X and gossips proposal.

Members vote by signing proposal hash.

Once threshold met, a member submits to committee:

proposalId

signedMessageHash (canonical)

evidence reference(s) (CID list of votes, membership snapshot CID)

Committee verifies:

votes are valid and meet policy.

proposal is not expired.

proposal corresponds to current epoch.

Committee produces group signature:

GroupAttestation block is created and gossiped.

Outsider verification

Outsider only needs:

PK_G (group public key)

GroupAttestation

signedMessageHash and signature verification

They do not need votes.

MVP vs Target

MVP: committee uses a normal signature key (single signer or n-of-n multisig behind the scenes).

Target: implement threshold signing (FROST or threshold BLS):

committee members hold shares

produce partial sigs

aggregate into one sig verifiable under PK_G

7) Revocation and Rekey

Revocation is a governance action:

RemoveMember(actorId) proposal

threshold vote → GroupAttestation

apply action:

new membership snapshot

new epoch state

rotate message key K_epoch+1

distribute new key only to remaining members

Important note:

Removed members will still be able to decrypt past epochs; preventing that requires forward secrecy and post-compromise security (MLS). For MVP, accept that limitation.

Deterministic, Order-Independent State Application

The system must be robust to message ordering and duplication.

Rules

Treat votes as a set keyed by (proposalId, voterActorId).

Treat proposals as immutable; if changed, it is a new proposalId.

Group epoch state is updated only when a governance action attestation exists or when a key rotation message exists and is authenticated.

Conflict handling

If competing epoch state updates appear:

select the one that has a valid GroupAttestation for the epoch transition.

if both valid (should not happen), tie-break by:

highest epoch number

then smallest CID lexicographically (deterministic)

Execution Engine (“Trigger X Process”)

Actions can be:

internal (update membership, rotate keys, change policy)

external (invoke a webhook, create a PR, publish something)

Define:

ActionHandlerRegistry mapping actionType -> handler

Handlers only execute when:

a valid GroupAttestation exists for the proposal

epoch matches

proposal is within validity window

Ensure idempotence:

Execution keyed by proposalId; persist “executed” marker.

Mesh Abuse Controls (Minimal but Required)

Implement these at mesh layer:

per-peer rate limits

per-peer block size limits

TTL enforcement

peer scoring (relays earn priority)

optional proof-of-work requirement for global rendezvous envelopes

At actor layer:

ignore unsolicited group invites unless user accepts or whitelists

ignore proposals from non-members for that group

Implementation Plan (Milestones)
Milestone 1: Mesh substrate

WebRTC signaling bootstrap (manual or via a rendezvous server).

Peer connections + DataChannels.

Block store + want/have/block protocol.

Basic gossip of “new CIDs.”

Milestone 2: Actor identity + feed

Generate/store identity keys.

Actor feed append and replication.

Rehydration from peers.

Milestone 3: Group messaging MVP

Group creation, membership list.

Epoch key distribution via per-recipient envelopes.

Encrypt/decrypt group messages.

Milestone 4: Governance voting MVP

Proposals, votes, counting against membership snapshot.

Deterministic evaluation.

Persist and replicate votes.

Milestone 5: Group attestation (committee signer MVP)

Committee service with normal signature key producing GroupAttestation.

Outsider verification with PK_G.

Execute actions when attested.

Milestone 6: True threshold signing (target)

Implement threshold signing among committee (FROST or threshold BLS).

Replace MVP committee signer.

Add committee rotation by governance.

Milestone 7: MLS-inspired TreeKEM (optional upgrade)

Replace per-member epoch key distribution with tree-based updates.

Improve forward secrecy / post-compromise security.

Deliverables for the Coding Agent

A TypeScript package (or monorepo) with modules:

mesh/ (webrtc, peers, protocols, blockstore)

crypto/ (keys, signing, encryption, serialization)

actor/ (feeds, identity, state rehydration)

group/ (membership, epochs, messaging)

governance/ (proposals, votes, policy evaluation)

attestation/ (committee signing service, verification, execution engine)

A minimal demo app:

open two+ browser tabs, connect peers

create group, invite member

send group message

propose action “TRIGGER_X”

vote on it

produce group attestation

show outsider verification and triggered action

Key Engineering Notes

Use deterministic serialization for CIDs.

Treat everything as content-addressed blocks; replicate aggressively but within caps.

Keep “global” as rendezvous-only and always encrypted.

Governance should be auditable internally (votes stored), but outsiders only need group signature.

Start with a committee signer MVP; threshold signing can be integrated later without changing the governance object model.

If you want, I can also provide:

A concrete message schema (exact JSON/CBOR fields),

A state machine for group epochs and membership transitions, and

A suggested library stack for Ed25519/X25519 + AEAD + threshold signing in the browser (including realistic caveats about what is production-ready today
