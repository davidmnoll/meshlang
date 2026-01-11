import type { Identity } from '../identity/types';
import type { StoredActor } from '../identity/storage';
import type { DatalogStore } from '../datalog/store';
import type { Mesh } from '../network/mesh';
import type { StoredFact, Value, Pattern } from '../datalog/types';
import { query, v, bindingsToObject } from '../datalog/query';
import { createExchangeUI } from '../bootstrap/clipboard';

interface AppContext {
  identity: Identity;
  store: DatalogStore;
  mesh: Mesh;
}

export interface ActorActions {
  onSwitchActor: (actorId: string) => boolean;
  onCreateActor: (name?: string) => Identity;
  onImportActor: (base64: string) => Identity | null;
  onExportActor: (actorId: string) => string | null;
  onDeleteActor: (actorId: string) => boolean;
  onRenameActor: (actorId: string, newName: string) => void;
  getActors: () => StoredActor[];
  getCurrentActorId: () => string | null;
}

function formatValue(value: Value): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === null) return 'null';
  return String(value);
}

function groupFactsByScope(facts: StoredFact[]): Map<string, StoredFact[]> {
  const groups = new Map<string, StoredFact[]>();
  for (const fact of facts) {
    const scope = fact.scope;
    if (!groups.has(scope)) {
      groups.set(scope, []);
    }
    groups.get(scope)!.push(fact);
  }
  return groups;
}

function parseValue(str: string): Value {
  const trimmed = str.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  // Remove quotes if present
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function renderFactTree(store: DatalogStore, nodeId: string): HTMLElement {
  const container = document.createElement('div');
  const facts = store.all();

  if (facts.length === 0) {
    container.innerHTML = '<p class="empty-state">No facts yet. Add some below.</p>';
    return container;
  }

  const groups = groupFactsByScope(facts);
  const list = document.createElement('ul');
  list.className = 'fact-list';

  for (const [scope, scopeFacts] of groups) {
    const scopeItem = document.createElement('li');
    scopeItem.className = 'tree-item';

    const header = document.createElement('div');
    header.className = 'tree-toggle';
    const scopeLabel = scope === nodeId ? `${scope} (current)` : scope;
    header.innerHTML = `<span class="scope">▼ ${scopeLabel}</span> <span style="color:#7f8c8d">(${scopeFacts.length})</span>`;
    header.onclick = () => scopeItem.classList.toggle('collapsed');

    const children = document.createElement('ul');
    children.className = 'tree-children fact-list';

    for (const storedFact of scopeFacts) {
      const factEl = document.createElement('li');
      factEl.className = 'fact-item';

      // Key (was attribute)
      const keySpan = document.createElement('span');
      keySpan.className = 'key';
      keySpan.textContent = storedFact.fact[0];

      const separator = document.createTextNode(': ');

      // Value - editable
      const valueSpan = document.createElement('span');
      valueSpan.className = 'value editable';
      valueSpan.textContent = formatValue(storedFact.fact[1]);
      valueSpan.title = 'Click to edit';

      valueSpan.onclick = () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'fact-edit-input';
        input.value = typeof storedFact.fact[1] === 'string'
          ? storedFact.fact[1]
          : String(storedFact.fact[1]);

        const saveEdit = () => {
          const newValue = parseValue(input.value);
          const oldFact = storedFact.fact;
          const scope = storedFact.scope;

          // Retract old fact and add new one
          store.retract(oldFact, scope);
          store.add([oldFact[0], newValue], nodeId, scope);
        };

        input.onblur = saveEdit;
        input.onkeydown = (e) => {
          if (e.key === 'Enter') {
            saveEdit();
          } else if (e.key === 'Escape') {
            // Cancel - just trigger re-render
            store.add(storedFact.fact, nodeId, storedFact.scope);
          }
        };

        valueSpan.replaceWith(input);
        input.focus();
        input.select();
      };

      factEl.appendChild(keySpan);
      factEl.appendChild(separator);
      factEl.appendChild(valueSpan);
      children.appendChild(factEl);
    }

    scopeItem.appendChild(header);
    scopeItem.appendChild(children);
    list.appendChild(scopeItem);
  }

  container.appendChild(list);
  return container;
}

function renderAddFactForm(store: DatalogStore, nodeId: string): HTMLElement {
  const form = document.createElement('div');
  form.className = 'add-fact-form';
  form.innerHTML = `
    <input type="text" id="fact-key" placeholder="key" />
    <input type="text" id="fact-value" placeholder="value" />
    <button id="add-fact-btn">Add</button>
  `;

  const keyInput = form.querySelector('#fact-key') as HTMLInputElement;
  const valueInput = form.querySelector('#fact-value') as HTMLInputElement;
  const addBtn = form.querySelector('#add-fact-btn') as HTMLButtonElement;

  const addFact = () => {
    const key = keyInput.value.trim();
    let value: Value = valueInput.value.trim();

    if (!key) return;

    // Try to parse as number or boolean
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (value === 'null') value = null;
    else if (/^-?\d+(\.\d+)?$/.test(value as string)) value = parseFloat(value as string);

    // Scope defaults to current actor (nodeId)
    store.add([key, value], nodeId);

    keyInput.value = '';
    valueInput.value = '';
    keyInput.focus();
  };

  addBtn.onclick = addFact;

  // Enter key to add
  [keyInput, valueInput].forEach((input) => {
    input.onkeydown = (e) => {
      if (e.key === 'Enter') addFact();
    };
  });

  return form;
}

function renderQueryBuilder(store: DatalogStore, nodeId: string): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'query-builder';

  panel.innerHTML = `
    <div class="query-pattern">
      <div class="pattern-slot" data-slot="scope">
        <label>Scope</label>
        <div class="slot-options">
          <button class="slot-btn active" data-type="current">Current</button>
          <button class="slot-btn" data-type="any">Any (?s)</button>
          <button class="slot-btn" data-type="specific">Specific</button>
        </div>
        <input type="text" class="slot-input hidden" placeholder="scope" />
      </div>

      <div class="pattern-slot" data-slot="key">
        <label>Key</label>
        <div class="slot-options">
          <button class="slot-btn" data-type="any">Any (?k)</button>
          <button class="slot-btn active" data-type="specific">Specific</button>
        </div>
        <input type="text" class="slot-input" placeholder="key" />
      </div>

      <div class="pattern-slot" data-slot="value">
        <label>Value</label>
        <div class="slot-options">
          <button class="slot-btn active" data-type="any">Any (?v)</button>
          <button class="slot-btn" data-type="specific">Specific</button>
        </div>
        <input type="text" class="slot-input hidden" placeholder="value" />
      </div>
    </div>

    <div class="query-preview">
      <code class="pattern-text"></code>
    </div>

    <div class="query-results empty">Configure pattern above</div>
  `;

  const slots = panel.querySelectorAll('.pattern-slot');
  const patternText = panel.querySelector('.pattern-text') as HTMLElement;
  const resultsDiv = panel.querySelector('.query-results') as HTMLDivElement;

  // State for each slot
  const state: Record<string, { type: string; value: string }> = {
    scope: { type: 'current', value: nodeId },
    key: { type: 'specific', value: '' },
    value: { type: 'any', value: '' },
  };

  function updatePreview() {
    const scopePart = state.scope.type === 'current' ? 'current'
      : state.scope.type === 'any' ? '?scope'
      : state.scope.value || '?scope';

    const keyPart = state.key.type === 'any' ? '?key'
      : state.key.value || '?key';

    const valuePart = state.value.type === 'any' ? '?val'
      : state.value.value || '?val';

    patternText.textContent = `(${keyPart}, ${valuePart}) in ${scopePart}`;
  }

  function runQuery() {
    try {
      // Build pattern
      const keyPattern = state.key.type === 'any'
        ? v('key')
        : parseValue(state.key.value);

      const valuePattern = state.value.type === 'any'
        ? v('val')
        : parseValue(state.value.value);

      const pattern: Pattern = [keyPattern, valuePattern];

      // Determine scope option
      const scopeOption = state.scope.type === 'current'
        ? { scope: nodeId }
        : state.scope.type === 'specific' && state.scope.value
          ? { scope: state.scope.value }
          : { scopePattern: v('scope') };

      const bindings = query(store, [pattern], scopeOption);

      if (bindings.length === 0) {
        resultsDiv.className = 'query-results empty';
        resultsDiv.textContent = 'No matches';
      } else {
        resultsDiv.className = 'query-results';
        resultsDiv.innerHTML = bindings
          .map((b) => `<div class="result-row">${JSON.stringify(bindingsToObject(b))}</div>`)
          .join('');
      }
    } catch (e) {
      resultsDiv.className = 'query-results empty';
      resultsDiv.textContent = `Error: ${e}`;
    }
  }

  // Set up slot interactions
  slots.forEach((slot) => {
    const slotName = (slot as HTMLElement).dataset.slot!;
    const buttons = slot.querySelectorAll('.slot-btn');
    const input = slot.querySelector('.slot-input') as HTMLInputElement;

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = (btn as HTMLElement).dataset.type!;

        // Update button states
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        // Update state
        state[slotName].type = type;

        // Show/hide input
        if (type === 'specific' || (slotName === 'scope' && type === 'specific')) {
          input.classList.remove('hidden');
          input.focus();
        } else {
          input.classList.add('hidden');
        }

        updatePreview();
        runQuery();
      });
    });

    input.addEventListener('input', () => {
      state[slotName].value = input.value;
      updatePreview();
      runQuery();
    });
  });

  // Initial state
  updatePreview();
  runQuery();

  return panel;
}

function getActorName(actorId: string, store: DatalogStore, fallbackName: string): string {
  const nameFact = store.findByScope(actorId).find((f) => f.fact[0] === 'name');
  return nameFact ? String(nameFact.fact[1]) : fallbackName;
}

function renderActorSwitcher(
  currentActorId: string,
  actorActions: ActorActions,
  store: DatalogStore
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'actor-switcher';

  const actors = actorActions.getActors();

  container.innerHTML = `
    <div class="actor-switcher-row">
      <select class="actor-select">
        ${actors.map((k) => `<option value="${k.id}" ${k.id === currentActorId ? 'selected' : ''}>${getActorName(k.id, store, k.name)}</option>`).join('')}
      </select>
      <button class="actor-btn" title="New Actor">+</button>
      <button class="actor-btn" title="Import Actor">Import</button>
      <button class="actor-btn" title="Export Actor">Export</button>
      <button class="actor-btn actor-btn-danger" title="Delete Actor">Delete</button>
    </div>
    <div class="actor-import-row hidden">
      <input type="text" class="actor-import-input" placeholder="Paste actor data..." />
      <button class="actor-import-btn">Import</button>
      <button class="actor-import-cancel">Cancel</button>
    </div>
    <div class="actor-export-row hidden">
      <textarea class="actor-export-output" readonly></textarea>
      <button class="actor-export-copy">Copy</button>
      <button class="actor-export-close">Close</button>
    </div>
  `;

  const select = container.querySelector('.actor-select') as HTMLSelectElement;
  const newBtn = container.querySelectorAll('.actor-btn')[0] as HTMLButtonElement;
  const importBtn = container.querySelectorAll('.actor-btn')[1] as HTMLButtonElement;
  const exportBtn = container.querySelectorAll('.actor-btn')[2] as HTMLButtonElement;
  const deleteBtn = container.querySelectorAll('.actor-btn')[3] as HTMLButtonElement;

  const importRow = container.querySelector('.actor-import-row') as HTMLElement;
  const importInput = container.querySelector('.actor-import-input') as HTMLInputElement;
  const importSubmit = container.querySelector('.actor-import-btn') as HTMLButtonElement;
  const importCancel = container.querySelector('.actor-import-cancel') as HTMLButtonElement;

  const exportRow = container.querySelector('.actor-export-row') as HTMLElement;
  const exportOutput = container.querySelector('.actor-export-output') as HTMLTextAreaElement;
  const exportCopy = container.querySelector('.actor-export-copy') as HTMLButtonElement;
  const exportClose = container.querySelector('.actor-export-close') as HTMLButtonElement;

  // Switch actor
  select.onchange = () => {
    actorActions.onSwitchActor(select.value);
  };

  // New actor
  newBtn.onclick = () => {
    const name = prompt('Enter a name for the new actor:', `Actor ${new Date().toLocaleString()}`);
    if (name !== null) {
      actorActions.onCreateActor(name || undefined);
    }
  };

  // Import actor
  importBtn.onclick = () => {
    importRow.classList.remove('hidden');
    importInput.focus();
  };

  importCancel.onclick = () => {
    importRow.classList.add('hidden');
    importInput.value = '';
  };

  importSubmit.onclick = () => {
    const data = importInput.value.trim();
    if (!data) return;

    const result = actorActions.onImportActor(data);
    if (result) {
      importRow.classList.add('hidden');
      importInput.value = '';
    } else {
      alert('Invalid actor data');
    }
  };

  // Export actor
  exportBtn.onclick = () => {
    const data = actorActions.onExportActor(currentActorId);
    if (data) {
      exportOutput.value = data;
      exportRow.classList.remove('hidden');
    }
  };

  exportCopy.onclick = async () => {
    await navigator.clipboard.writeText(exportOutput.value);
    exportCopy.textContent = 'Copied!';
    setTimeout(() => (exportCopy.textContent = 'Copy'), 2000);
  };

  exportClose.onclick = () => {
    exportRow.classList.add('hidden');
    exportOutput.value = '';
  };

  // Delete actor
  deleteBtn.onclick = () => {
    if (actors.length <= 1) {
      alert('Cannot delete the last actor');
      return;
    }
    if (confirm('Are you sure you want to delete this actor?')) {
      actorActions.onDeleteActor(currentActorId);
    }
  };

  return container;
}

export function renderApp(
  container: HTMLElement,
  ctx: AppContext,
  actorActions: ActorActions
): void {
  const { identity, store, mesh } = ctx;

  function render() {
    const peerCount = mesh.getPeerCount();

    container.innerHTML = '';

    // Header with actor switcher
    const header = document.createElement('div');
    header.className = 'header';

    const nodeInfo = document.createElement('div');
    nodeInfo.className = 'header-info';
    nodeInfo.innerHTML = `
      <div class="node-id">Node: ${identity.nodeId}</div>
      <div class="peer-count ${peerCount > 0 ? 'connected' : ''}">
        ${peerCount} peer${peerCount !== 1 ? 's' : ''} connected
      </div>
    `;

    header.appendChild(nodeInfo);
    header.appendChild(renderActorSwitcher(identity.nodeId, actorActions, store));
    container.appendChild(header);

    // Facts section
    const factsSection = document.createElement('div');
    factsSection.className = 'section';
    factsSection.innerHTML = `
      <div class="section-header">
        <h2>Facts</h2>
        <span>${store.all().length} total</span>
      </div>
    `;
    const factsContent = document.createElement('div');
    factsContent.className = 'section-content';
    factsContent.appendChild(renderFactTree(store, identity.nodeId));
    factsContent.appendChild(renderAddFactForm(store, identity.nodeId));
    factsSection.appendChild(factsContent);
    container.appendChild(factsSection);

    // Query section
    const querySection = document.createElement('div');
    querySection.className = 'section';
    querySection.innerHTML = `
      <div class="section-header">
        <h2>Query</h2>
      </div>
    `;
    const queryContent = document.createElement('div');
    queryContent.className = 'section-content';
    queryContent.appendChild(renderQueryBuilder(store, identity.nodeId));
    querySection.appendChild(queryContent);
    container.appendChild(querySection);

    // Connect section
    const connectSection = document.createElement('div');
    connectSection.className = 'section';
    connectSection.innerHTML = `
      <div class="section-header">
        <h2>Connect</h2>
      </div>
    `;
    const connectContent = document.createElement('div');
    connectContent.className = 'section-content';
    createExchangeUI(connectContent, mesh, render);
    connectSection.appendChild(connectContent);
    container.appendChild(connectSection);
  }

  // Initial render
  render();

  // Re-render on store changes
  store.onAdd(() => render());

  // Re-render on mesh changes
  mesh.onChange(() => render());
}
