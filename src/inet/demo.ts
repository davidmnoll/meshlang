// Interactive demo of interaction nets for queries
//
// Run with: npx ts-node src/inet/demo.ts

import {
  createNet,
  createFact,
  createMatch,
  createResult,
  connect,
  lit,
  varPat,
} from './net';
import { reduce } from './rules';
import { visualizeNet, netStats } from './visualize';
import { executeQuery, q, v, inScope } from './query';

console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║     Interaction Nets for Query Pattern Matching               ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log('');

// ============ Demo 1: Direct Net Construction ============

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Demo 1: Manual Net Construction');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('Building a net with:');
console.log('  - Fact: [name, "Alice"] in scope "user1"');
console.log('  - Match query: [name, ?n]');
console.log('');

const net1 = createNet();

// Create a fact
const fact = createFact(net1, 'name', 'Alice', 'user1');

// Create a match query looking for [name, ?n]
const match = createMatch(net1, lit('name'), varPat('n'));

// Create result collector
const result = createResult(net1);

// Connect match result to collector
connect(
  net1,
  match.ports.get('result_out')!.id,
  result.ports.get('collect')!.id
);

// Connect fact to match (this creates an active pair!)
connect(
  net1,
  fact.ports.get('principal')!.id,
  match.ports.get('principal')!.id
);

console.log('Before reduction:');
console.log(visualizeNet(net1));
console.log('');
console.log('Stats:', netStats(net1));
console.log('');

// Reduce the net
console.log('Reducing...');
const steps1 = reduce(net1);
console.log(`Completed in ${steps1} steps`);
console.log('');

console.log('After reduction:');
console.log(visualizeNet(net1));
console.log('');

// ============ Demo 2: Query DSL ============

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Demo 2: Query DSL');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

const facts = [
  { key: 'name', value: 'Alice', scope: 'user1' },
  { key: 'age', value: 30, scope: 'user1' },
  { key: 'city', value: 'NYC', scope: 'user1' },
  { key: 'name', value: 'Bob', scope: 'user2' },
  { key: 'age', value: 25, scope: 'user2' },
  { key: 'city', value: 'LA', scope: 'user2' },
  { key: 'name', value: 'Charlie', scope: 'user3' },
  { key: 'age', value: 35, scope: 'user3' },
];

console.log('Facts:');
facts.forEach((f) => console.log(`  [${f.key}, ${JSON.stringify(f.value)}] @${f.scope}`));
console.log('');

// Query 1: Find all names
console.log('Query 1: [name, ?n]');
console.log('  "Find all names"');
const r1 = executeQuery([q('name', v('n'))], facts);
console.log('  Results:');
r1.forEach((b) => console.log('    ', Object.fromEntries(b)));
console.log('');

// Query 2: Find name and age in same scope
console.log('Query 2: [name, ?n] + [age, ?a] in same ?scope');
console.log('  "Find name and age pairs for each user"');
const r2 = executeQuery(
  [
    inScope(q('name', v('n')), v('scope')),
    inScope(q('age', v('a')), v('scope')),
  ],
  facts
);
console.log('  Results:');
r2.forEach((b) => console.log('    ', Object.fromEntries(b)));
console.log('');

// Query 3: Find users in NYC
console.log('Query 3: [name, ?n] + [city, "NYC"] in same ?scope');
console.log('  "Find names of users in NYC"');
const r3 = executeQuery(
  [
    inScope(q('name', v('n')), v('scope')),
    inScope(q('city', 'NYC'), v('scope')),
  ],
  facts
);
console.log('  Results:');
r3.forEach((b) => console.log('    ', Object.fromEntries(b)));
console.log('');

// Query 4: Find users over 25
console.log('Query 4: [name, ?n] + [age, ?a] where age > 25');
console.log('  (Post-filter, inet would need numeric comparison agents)');
const r4 = executeQuery(
  [
    inScope(q('name', v('n')), v('scope')),
    inScope(q('age', v('a')), v('scope')),
  ],
  facts
).filter((b) => (b.get('a') as number) > 25);
console.log('  Results:');
r4.forEach((b) => console.log('    ', Object.fromEntries(b)));
console.log('');

// Query 5: Self-join - find same value for different keys
console.log('Query 5: [?k1, ?v] + [?k2, ?v] where k1 != k2');
console.log('  "Find shared values across different keys"');

// Add some facts with shared values
const factsWithSharing = [
  ...facts,
  { key: 'favorite_number', value: 30, scope: 'user1' }, // same as Alice's age
  { key: 'lucky_number', value: 25, scope: 'user2' },    // same as Bob's age
];

const r5 = executeQuery(
  [
    q(v('k1'), v('val')),
    q(v('k2'), v('val')),
  ],
  factsWithSharing
).filter((b) => b.get('k1') !== b.get('k2'));
console.log('  Results:');
r5.forEach((b) => console.log('    ', Object.fromEntries(b)));
console.log('');

// ============ Demo 3: Interaction Semantics Explained ============

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Demo 3: How Interaction Rules Work');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('Fact >< Match Rule:');
console.log('');
console.log('  BEFORE:                    AFTER (match):');
console.log('');
console.log('      scope_out                  (consumed)');
console.log('          │');
console.log('    key ──●── value');
console.log('          │                      Val({n:"Alice"})');
console.log('     ═════╪═════                      │');
console.log('          │                           │');
console.log('    "name"──●──?n                     ▼');
console.log('          │                      result_out');
console.log('      result_out');
console.log('');
console.log('  The Match agent compares its patterns against the Fact.');
console.log('  If they match, it emits a Val with bindings.');
console.log('  If not, it emits Era (eraser) to clean up.');
console.log('');
console.log('Dup >< Fact Rule (for replication):');
console.log('');
console.log('  BEFORE:                    AFTER:');
console.log('');
console.log('       copy1                  copy1──Fact\'');
console.log('         │                          │');
console.log('  Fact──●──Dup          =>');
console.log('         │                          │');
console.log('       copy2                  copy2──Fact\'\'');
console.log('');
console.log('  Dup duplicates the Fact, allowing multiple queries');
console.log('  to each receive their own copy.');
console.log('');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Key Concepts:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('1. ACTIVE PAIRS: Two agents connected at principal ports (●)');
console.log('   Only active pairs can reduce (interact).');
console.log('');
console.log('2. LOCALITY: Each reduction only looks at the two agents');
console.log('   involved - no global state needed.');
console.log('');
console.log('3. PARALLELISM: Non-overlapping active pairs can reduce');
console.log('   simultaneously - inherent parallelism.');
console.log('');
console.log('4. OPTIMAL SHARING: Term graph representation means shared');
console.log('   subexpressions are computed once (memoization for free).');
console.log('');
console.log('5. LINEARITY: Each wire is used exactly once, but Dup/Era');
console.log('   agents handle copying and cleanup.');
console.log('');
