import type { Identity } from '../identity/types';
import type { StoredActor } from '../identity/storage';
import type { DatalogStore } from '../datalog/store';
import type { Mesh } from '../network/mesh';
import type { Value, Pattern } from '../datalog/types';
import type { NavigationState, ScopeId } from '../scope/types';
import { query, v, bindingsToObject } from '../datalog/query';
import { createExchangeUI } from '../bootstrap/clipboard';
import {
  createNavigationState,
  navigateToChild,
  navigateToParent,
  navigateToPathIndex,
  switchParentPath,
  getScopeName,
  getParentScopes,
  getNavigableFacts,
} from '../scope/navigation';
import {
  createAutocompleteInput,
  getAutocompleteValue,
  clearAutocomplete,
  focusAutocomplete,
  getAutocompleteInput,
} from './autocomplete';
import { tryParseExpression } from '../expr/parse';
import { formatExpression, isConstructor } from '../expr/types';

// Helper to check if current scope is a peer scope
// A peer scope is one we navigated to via a peer(...) constructor fact
function isPeerScope(store: DatalogStore, navigation: NavigationState): { isPeer: boolean; peerId?: string } {
  if (navigation.path.length < 2) {
    return { isPeer: false };
  }

  // Get the parent scope
  const parentScopeId = navigation.path[navigation.path.length - 2];
  const currentScopeId = navigation.currentScope;

  // Find the fact in parent scope that led to this scope
  const parentFacts = store.findByScope(parentScopeId);
  for (const fact of parentFacts) {
    // The fact ID becomes the child scope ID when navigating
    if (fact.id === currentScopeId) {
      const key = fact.fact[0];
      // Check if it's a peer(...) constructor
      const peerMatch = key.match(/^peer\("([^"]+)"\)$/);
      if (peerMatch) {
        return { isPeer: true, peerId: peerMatch[1] };
      }
    }
  }

  return { isPeer: false };
}

interface AppContext {
  identity: Identity;
  store: DatalogStore;
  mesh: Mesh;
  navigation?: NavigationState;  // Optional - created if not provided
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

// Scope navigator with breadcrumbs (DAG-aware)
function renderScopeNavigator(
  store: DatalogStore,
  navigation: NavigationState,
  onNavigate: (newState: NavigationState) => void
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'scope-navigator';

  // Breadcrumbs
  const breadcrumbs = document.createElement('div');
  breadcrumbs.className = 'breadcrumbs';

  navigation.path.forEach((scopeId, index) => {
    const crumb = document.createElement('div');
    crumb.className = 'breadcrumb';

    const name = getScopeName(store, scopeId);
    const parents = getParentScopes(store, scopeId);
    const isLast = index === navigation.path.length - 1;

    // If this scope has multiple parents, show dropdown
    if (index > 0 && parents.length > 1) {
      const dropdown = document.createElement('select');
      dropdown.className = 'breadcrumb-dropdown';

      // Current parent (the one in path)
      const currentParent = navigation.path[index - 1];

      parents.forEach((parentId) => {
        const option = document.createElement('option');
        option.value = parentId;
        option.textContent = getScopeName(store, parentId);
        option.selected = parentId === currentParent;
        dropdown.appendChild(option);
      });

      dropdown.onchange = () => {
        const newState = switchParentPath(navigation, index, dropdown.value);
        onNavigate(newState);
      };

      crumb.appendChild(dropdown);
      crumb.appendChild(document.createTextNode(' / '));
    } else if (index > 0) {
      crumb.appendChild(document.createTextNode(' / '));
    }

    // Scope name (clickable unless it's the current scope)
    const nameSpan = document.createElement('span');
    nameSpan.className = `breadcrumb-name ${isLast ? 'current' : 'clickable'}`;
    nameSpan.textContent = name;

    if (!isLast) {
      nameSpan.onclick = () => {
        const newState = navigateToPathIndex(navigation, index);
        onNavigate(newState);
      };
    }

    crumb.appendChild(nameSpan);
    breadcrumbs.appendChild(crumb);
  });

  container.appendChild(breadcrumbs);

  // Navigable facts (facts you can enter like directories)
  const navigable = getNavigableFacts(store, navigation.currentScope);
  if (navigable.length > 0) {
    const navList = document.createElement('div');
    navList.className = 'navigable-facts';

    const label = document.createElement('span');
    label.className = 'navigable-facts-label';
    label.textContent = 'Enter: ';
    navList.appendChild(label);

    navigable.forEach((fact) => {
      const factBtn = document.createElement('button');
      factBtn.className = 'navigable-fact-btn';
      factBtn.textContent = fact.displayName;
      factBtn.title = fact.key;
      factBtn.onclick = () => {
        const newState = navigateToChild(navigation, fact.id);
        onNavigate(newState);
      };
      navList.appendChild(factBtn);
    });

    container.appendChild(navList);
  }

  // Up button
  if (navigation.path.length > 1) {
    const upBtn = document.createElement('button');
    upBtn.className = 'scope-up-btn';
    upBtn.textContent = '↑ Up';
    upBtn.onclick = () => {
      const newState = navigateToParent(navigation);
      if (newState) onNavigate(newState);
    };
    container.appendChild(upBtn);
  }

  return container;
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

// Render facts for current scope only
function renderFactTree(store: DatalogStore, currentScope: ScopeId, nodeId: string): HTMLElement {
  const container = document.createElement('div');
  const facts = store.findByScope(currentScope);

  if (facts.length === 0) {
    container.innerHTML = '<p class="empty-state">No facts in this scope. Add some below.</p>';
    return container;
  }

  const list = document.createElement('ul');
  list.className = 'fact-list';

  for (const storedFact of facts) {
    const factEl = document.createElement('li');
    factEl.className = 'fact-item';

    // Key
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

        // Retract old fact and add new one
        store.retract(oldFact, currentScope);
        store.add([oldFact[0], newValue], nodeId, currentScope);
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
    list.appendChild(factEl);
  }

  container.appendChild(list);
  return container;
}

function renderAddFactForm(store: DatalogStore, currentScope: ScopeId, nodeId: string): HTMLElement {
  const form = document.createElement('div');
  form.className = 'add-fact-form';

  let currentKeyValue = '';

  // Key input with autocomplete
  const keyAutocomplete = createAutocompleteInput({
    store,
    scope: currentScope,
    type: 'key',
    placeholder: 'key (e.g., name, eq(x))',
    onChange: (v) => {
      currentKeyValue = v;
    },
  });

  // Value input with autocomplete
  const valueAutocomplete = createAutocompleteInput({
    store,
    scope: currentScope,
    type: 'value',
    placeholder: 'value',
    forKey: currentKeyValue,
  });

  const addBtn = document.createElement('button');
  addBtn.id = 'add-fact-btn';
  addBtn.textContent = 'Add';

  const addFact = () => {
    const keyStr = getAutocompleteValue(keyAutocomplete).trim();
    const valueStr = getAutocompleteValue(valueAutocomplete).trim();

    if (!keyStr) return;

    // Parse key as expression (could be constructor like eq(x))
    const keyExpr = tryParseExpression(keyStr);
    const key = keyExpr !== null && isConstructor(keyExpr)
      ? formatExpression(keyExpr)
      : keyStr;

    // Parse value
    let value: Value = valueStr;
    if (valueStr === 'true') value = true;
    else if (valueStr === 'false') value = false;
    else if (valueStr === 'null') value = null;
    else if (/^-?\d+(\.\d+)?$/.test(valueStr)) value = parseFloat(valueStr);

    // Add to current scope
    store.add([key, value], nodeId, currentScope);

    clearAutocomplete(keyAutocomplete);
    clearAutocomplete(valueAutocomplete);
    focusAutocomplete(keyAutocomplete);
  };

  addBtn.onclick = addFact;

  // Enter key to add (on value input)
  const valueInput = getAutocompleteInput(valueAutocomplete);
  if (valueInput) {
    const originalKeydown = valueInput.onkeydown;
    valueInput.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.defaultPrevented) {
        // Only add if dropdown is hidden (not selecting from dropdown)
        const dropdown = valueAutocomplete.querySelector('.autocomplete-dropdown');
        if (dropdown?.classList.contains('hidden')) {
          addFact();
          e.preventDefault();
        }
      }
      originalKeydown?.call(valueInput, e);
    };
  }

  // Tab from key to value
  const keyInput = getAutocompleteInput(keyAutocomplete);
  if (keyInput) {
    const originalKeydown = keyInput.onkeydown;
    keyInput.onkeydown = (e) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        const dropdown = keyAutocomplete.querySelector('.autocomplete-dropdown');
        if (dropdown?.classList.contains('hidden')) {
          e.preventDefault();
          focusAutocomplete(valueAutocomplete);
        }
      }
      originalKeydown?.call(keyInput, e);
    };
  }

  form.appendChild(keyAutocomplete);
  form.appendChild(valueAutocomplete);
  form.appendChild(addBtn);

  return form;
}

// Query builder - only searches in current scope
function renderQueryBuilder(store: DatalogStore, currentScope: ScopeId): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'query-builder';

  const header = document.createElement('h4');
  header.textContent = 'Query';
  panel.appendChild(header);

  const patternDiv = document.createElement('div');
  patternDiv.className = 'query-pattern';

  // State for each slot
  const state = {
    key: { type: 'any', value: '' },
    value: { type: 'any', value: '' },
  };

  const resultsDiv = document.createElement('div');
  resultsDiv.className = 'query-results empty';
  resultsDiv.textContent = 'Enter a pattern to query';

  const previewDiv = document.createElement('div');
  previewDiv.className = 'query-preview';
  const previewCode = document.createElement('code');
  previewCode.className = 'pattern-text';
  previewDiv.appendChild(previewCode);

  function updatePreview() {
    const keyPart = state.key.type === 'any' ? '?key' : state.key.value || '?key';
    const valuePart = state.value.type === 'any' ? '?val' : state.value.value || '?val';
    previewCode.textContent = `[${keyPart}, ${valuePart}]`;
  }

  function runQuery() {
    try {
      const keyPattern = state.key.type === 'any'
        ? v('key')
        : parseValue(state.key.value);

      const valuePattern = state.value.type === 'any'
        ? v('val')
        : parseValue(state.value.value);

      const pattern: Pattern = [keyPattern, valuePattern];
      const bindings = query(store, [pattern], { scope: currentScope });

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

  // Create slots with autocomplete
  function createSlot(name: string, label: string, type: 'key' | 'value') {
    const slot = document.createElement('div');
    slot.className = 'pattern-slot';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    slot.appendChild(labelEl);

    const options = document.createElement('div');
    options.className = 'slot-options';

    const anyBtn = document.createElement('button');
    anyBtn.className = 'slot-btn active';
    anyBtn.textContent = `Any (?${name[0]})`;
    anyBtn.dataset.type = 'any';

    const specificBtn = document.createElement('button');
    specificBtn.className = 'slot-btn';
    specificBtn.textContent = 'Specific';
    specificBtn.dataset.type = 'specific';

    options.appendChild(anyBtn);
    options.appendChild(specificBtn);
    slot.appendChild(options);

    const autocomplete = createAutocompleteInput({
      store,
      scope: currentScope,
      type,
      placeholder: name,
      onChange: (v) => {
        state[name as 'key' | 'value'].value = v;
        updatePreview();
        runQuery();
      },
    });
    autocomplete.classList.add('hidden');
    slot.appendChild(autocomplete);

    [anyBtn, specificBtn].forEach((btn) => {
      btn.onclick = () => {
        anyBtn.classList.toggle('active', btn === anyBtn);
        specificBtn.classList.toggle('active', btn === specificBtn);
        state[name as 'key' | 'value'].type = btn.dataset.type!;

        if (btn.dataset.type === 'specific') {
          autocomplete.classList.remove('hidden');
          focusAutocomplete(autocomplete);
        } else {
          autocomplete.classList.add('hidden');
        }

        updatePreview();
        runQuery();
      };
    });

    return slot;
  }

  patternDiv.appendChild(createSlot('key', 'Key', 'key'));
  patternDiv.appendChild(createSlot('value', 'Value', 'value'));

  panel.appendChild(patternDiv);
  panel.appendChild(previewDiv);
  panel.appendChild(resultsDiv);

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

  // Navigation state - starts at actor's root scope
  let navigation = ctx.navigation || createNavigationState(identity.nodeId);

  function handleNavigate(newState: NavigationState) {
    navigation = newState;
    render();
  }

  function render() {
    const peerCount = mesh.getPeerCount();
    const currentScope = navigation.currentScope;
    const scopeFacts = store.findByScope(currentScope);

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

    // Scope Navigator section
    const scopeSection = document.createElement('div');
    scopeSection.className = 'section';
    scopeSection.innerHTML = `
      <div class="section-header">
        <h2>Scope</h2>
      </div>
    `;
    const scopeContent = document.createElement('div');
    scopeContent.className = 'section-content';
    scopeContent.appendChild(renderScopeNavigator(store, navigation, handleNavigate));
    scopeSection.appendChild(scopeContent);
    container.appendChild(scopeSection);

    // Facts section (current scope only)
    const factsSection = document.createElement('div');
    factsSection.className = 'section';
    factsSection.innerHTML = `
      <div class="section-header">
        <h2>Facts</h2>
        <span>${scopeFacts.length} in scope</span>
      </div>
    `;
    const factsContent = document.createElement('div');
    factsContent.className = 'section-content';
    factsContent.appendChild(renderFactTree(store, currentScope, identity.nodeId));
    factsContent.appendChild(renderAddFactForm(store, currentScope, identity.nodeId));
    factsSection.appendChild(factsContent);
    container.appendChild(factsSection);

    // Query section (current scope only)
    const querySection = document.createElement('div');
    querySection.className = 'section';
    querySection.innerHTML = `
      <div class="section-header">
        <h2>Query</h2>
      </div>
    `;
    const queryContent = document.createElement('div');
    queryContent.className = 'section-content';
    queryContent.appendChild(renderQueryBuilder(store, currentScope));
    querySection.appendChild(queryContent);
    container.appendChild(querySection);

    // Peer Connect section - only shown when inside a peer scope
    const peerInfo = isPeerScope(store, navigation);
    if (peerInfo.isPeer) {
      const connectSection = document.createElement('div');
      connectSection.className = 'section';
      connectSection.innerHTML = `
        <div class="section-header">
          <h2>Peer Connection</h2>
          <span>peer(${peerInfo.peerId?.slice(0, 8)}...)</span>
        </div>
      `;
      const connectContent = document.createElement('div');
      connectContent.className = 'section-content';
      createExchangeUI(connectContent, mesh, render);
      connectSection.appendChild(connectContent);
      container.appendChild(connectSection);
    }
  }

  // Initial render
  render();

  // Re-render on store changes
  store.onAdd(() => render());

  // Re-render on mesh changes
  mesh.onChange(() => render());
}
