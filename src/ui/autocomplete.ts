// Autocomplete Input Component

import type { DatalogStore } from '../datalog/store';
import type { Suggestion } from '../expr/autocomplete';
import { suggestKeys, suggestValues } from '../expr/autocomplete';

export interface AutocompleteConfig {
  store: DatalogStore;
  scope: string;
  type: 'key' | 'value';
  placeholder: string;
  forKey?: string;  // For value inputs, what key is this value for
  onSelect?: (value: string) => void;
  onChange?: (value: string) => void;
}

export function createAutocompleteInput(config: AutocompleteConfig): HTMLElement {
  const container = document.createElement('div');
  container.className = 'autocomplete-container';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'autocomplete-input';
  input.placeholder = config.placeholder;
  input.autocomplete = 'off';

  const dropdown = document.createElement('div');
  dropdown.className = 'autocomplete-dropdown hidden';

  container.appendChild(input);
  container.appendChild(dropdown);

  let selectedIndex = -1;
  let suggestions: Suggestion[] = [];

  function positionDropdown() {
    const rect = input.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 2}px`;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${rect.width}px`;
  }

  function updateDropdown() {
    const value = input.value;

    if (config.type === 'key') {
      suggestions = suggestKeys(config.store, config.scope, value);
    } else {
      suggestions = suggestValues(config.store, config.scope, value, config.forKey);
    }

    // Limit suggestions
    suggestions = suggestions.slice(0, 10);

    if (suggestions.length === 0 || (suggestions.length === 1 && suggestions[0].text === value)) {
      dropdown.classList.add('hidden');
      return;
    }

    dropdown.innerHTML = '';
    selectedIndex = -1;
    positionDropdown();

    suggestions.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.dataset.index = String(i);

      const textSpan = document.createElement('span');
      textSpan.className = 'autocomplete-item-text';
      textSpan.textContent = s.display;

      item.appendChild(textSpan);

      if (s.description) {
        const descSpan = document.createElement('span');
        descSpan.className = 'autocomplete-item-desc';
        descSpan.textContent = s.description;
        item.appendChild(descSpan);
      }

      const typeSpan = document.createElement('span');
      typeSpan.className = `autocomplete-item-type type-${s.type}`;
      typeSpan.textContent = s.type;
      item.appendChild(typeSpan);

      item.onclick = () => selectItem(i);
      item.onmouseenter = () => {
        selectedIndex = i;
        updateSelection();
      };

      dropdown.appendChild(item);
    });

    dropdown.classList.remove('hidden');
  }

  function updateSelection() {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === selectedIndex);
    });
  }

  function selectItem(index: number) {
    if (index < 0 || index >= suggestions.length) return;

    const suggestion = suggestions[index];
    const text = suggestion.completion || suggestion.text;

    input.value = text;
    dropdown.classList.add('hidden');

    // If it's a constructor with args, position cursor inside parens
    if (text.endsWith('(')) {
      input.value = text + ')';
      input.setSelectionRange(text.length, text.length);
    }

    config.onSelect?.(input.value);
    config.onChange?.(input.value);
  }

  // Event handlers
  input.oninput = () => {
    updateDropdown();
    config.onChange?.(input.value);
  };

  input.onfocus = () => {
    updateDropdown();
  };

  input.onblur = () => {
    // Delay to allow click on dropdown
    setTimeout(() => {
      dropdown.classList.add('hidden');
    }, 200);
  };

  input.onkeydown = (e) => {
    if (dropdown.classList.contains('hidden')) {
      if (e.key === 'ArrowDown') {
        updateDropdown();
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
        updateSelection();
        break;

      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelection();
        break;

      case 'Enter':
        if (selectedIndex >= 0) {
          e.preventDefault();
          selectItem(selectedIndex);
        }
        break;

      case 'Escape':
        dropdown.classList.add('hidden');
        break;

      case 'Tab':
        if (selectedIndex >= 0) {
          selectItem(selectedIndex);
        } else if (suggestions.length > 0) {
          selectItem(0);
        }
        break;
    }
  };

  // Expose methods
  (container as any).getValue = () => input.value;
  (container as any).setValue = (v: string) => {
    input.value = v;
    config.onChange?.(v);
  };
  (container as any).clear = () => {
    input.value = '';
    config.onChange?.('');
  };
  (container as any).focus = () => input.focus();
  (container as any).getInput = () => input;

  return container;
}

// Helper to get value from autocomplete container
export function getAutocompleteValue(container: HTMLElement): string {
  return (container as any).getValue?.() || '';
}

export function setAutocompleteValue(container: HTMLElement, value: string): void {
  (container as any).setValue?.(value);
}

export function clearAutocomplete(container: HTMLElement): void {
  (container as any).clear?.();
}

export function focusAutocomplete(container: HTMLElement): void {
  (container as any).focus?.();
}

export function getAutocompleteInput(container: HTMLElement): HTMLInputElement | null {
  return (container as any).getInput?.() || null;
}
