// Visualization and debugging for interaction nets

import type { Net } from './types';

// Generate ASCII art representation of the net
export function visualizeNet(net: Net): string {
  const lines: string[] = [];

  lines.push('=== Interaction Net ===');
  lines.push('');

  // List agents
  lines.push('Agents:');
  for (const agent of net.agents.values()) {
    const ports = Array.from(agent.ports.values())
      .map((p) => `${p.isPrincipal ? '*' : ''}${p.name}`)
      .join(', ');

    let data = '';
    switch (agent.data.type) {
      case 'Fact':
        data = `[${agent.data.key}, ${JSON.stringify(agent.data.value)}] @${agent.data.scope}`;
        break;
      case 'Match':
        const kp = agent.data.keyPattern;
        const vp = agent.data.valuePattern;
        data = `[${kp.type === 'lit' ? JSON.stringify(kp.value) : '?' + kp.name}, ${vp.type === 'lit' ? JSON.stringify(vp.value) : '?' + vp.name}]`;
        break;
      case 'Join':
        data = `arity=${agent.data.arity}, received=${agent.data.received}`;
        break;
      case 'Var':
        data = `?${agent.data.name}`;
        break;
      case 'Val':
        data = JSON.stringify(agent.data.value);
        break;
      case 'Scope':
        data = agent.data.scope ?? '?scope';
        break;
      default:
        data = '';
    }

    lines.push(`  ${agent.type}(${agent.id.slice(-4)}): ${data}`);
    lines.push(`    ports: [${ports}]`);
  }

  lines.push('');

  // List wires (connections)
  lines.push('Wires:');
  for (const wire of net.wires.values()) {
    const port1 = net.ports.get(wire.ports[0]);
    const port2 = net.ports.get(wire.ports[1]);
    if (!port1 || !port2) continue;

    const agent1 = net.agents.get(port1.agent);
    const agent2 = net.agents.get(port2.agent);
    if (!agent1 || !agent2) continue;

    const p1 = port1.isPrincipal ? '*' : '';
    const p2 = port2.isPrincipal ? '*' : '';

    lines.push(
      `  ${agent1.type}(${agent1.id.slice(-4)}).${p1}${port1.name} <---> ${agent2.type}(${agent2.id.slice(-4)}).${p2}${port2.name}`
    );
  }

  // Identify active pairs
  const activePairs: string[] = [];
  for (const wire of net.wires.values()) {
    const port1 = net.ports.get(wire.ports[0]);
    const port2 = net.ports.get(wire.ports[1]);
    if (port1?.isPrincipal && port2?.isPrincipal) {
      const agent1 = net.agents.get(port1.agent);
      const agent2 = net.agents.get(port2.agent);
      if (agent1 && agent2) {
        activePairs.push(`${agent1.type} >< ${agent2.type}`);
      }
    }
  }

  if (activePairs.length > 0) {
    lines.push('');
    lines.push('Active Pairs (can reduce):');
    for (const pair of activePairs) {
      lines.push(`  ${pair}`);
    }
  }

  return lines.join('\n');
}

// Generate DOT format for Graphviz visualization
export function netToDot(net: Net): string {
  const lines: string[] = [];

  lines.push('digraph InteractionNet {');
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=record];');
  lines.push('');

  // Agents as nodes
  for (const agent of net.agents.values()) {
    const ports = Array.from(agent.ports.values())
      .map((p) => `<${p.name}>${p.isPrincipal ? '●' : '○'}${p.name}`)
      .join('|');

    let label: string = agent.type;
    switch (agent.data.type) {
      case 'Fact':
        label = `Fact\\n${agent.data.key}:${JSON.stringify(agent.data.value)}`;
        break;
      case 'Match':
        const kp = agent.data.keyPattern;
        const vp = agent.data.valuePattern;
        label = `Match\\n${kp.type === 'lit' ? kp.value : '?' + kp.name}:${vp.type === 'lit' ? vp.value : '?' + vp.name}`;
        break;
      case 'Val':
        label = `Val\\n${JSON.stringify(agent.data.value).slice(0, 20)}`;
        break;
    }

    lines.push(`  "${agent.id}" [label="{${label}|{${ports}}}"];`);
  }

  lines.push('');

  // Wires as edges
  for (const wire of net.wires.values()) {
    const port1 = net.ports.get(wire.ports[0]);
    const port2 = net.ports.get(wire.ports[1]);
    if (!port1 || !port2) continue;

    const style = port1.isPrincipal && port2.isPrincipal ? 'bold,color=red' : '';

    lines.push(
      `  "${port1.agent}":${port1.name} -> "${port2.agent}":${port2.name} [style="${style}",dir=none];`
    );
  }

  lines.push('}');
  return lines.join('\n');
}

// Statistics about the net
export function netStats(net: Net): {
  agents: number;
  wires: number;
  activePairs: number;
  byType: Record<string, number>;
} {
  const byType: Record<string, number> = {};

  for (const agent of net.agents.values()) {
    byType[agent.type] = (byType[agent.type] || 0) + 1;
  }

  let activePairs = 0;
  for (const wire of net.wires.values()) {
    const port1 = net.ports.get(wire.ports[0]);
    const port2 = net.ports.get(wire.ports[1]);
    if (port1?.isPrincipal && port2?.isPrincipal) {
      activePairs++;
    }
  }

  return {
    agents: net.agents.size,
    wires: net.wires.size,
    activePairs,
    byType,
  };
}
