// Expression Parser
//
// Parses strings into Expression types:
// - "hello" or hello → literal string
// - 42, 3.14 → literal number
// - true, false → literal boolean
// - null → literal null
// - ?x, ?name → variable
// - name → 0-ary constructor
// - eq(x) → 1-ary constructor with arg
// - add(1, 2) → 2-ary constructor with args
// - @scopeId → scope reference

import type { Expression } from './types';
import { variable, constructor, scopeRef } from './types';

export class ParseError extends Error {
  constructor(message: string, public position: number) {
    super(message);
    this.name = 'ParseError';
  }
}

// Tokenizer
type Token =
  | { type: 'identifier'; value: string }
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' }
  | { type: 'variable'; name: string }
  | { type: 'scope'; id: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    // Variable: ?name
    if (input[i] === '?') {
      i++;
      let name = '';
      while (i < input.length && /[\w]/.test(input[i])) {
        name += input[i++];
      }
      if (name.length === 0) {
        throw new ParseError('Expected variable name after ?', i);
      }
      tokens.push({ type: 'variable', name });
      continue;
    }

    // Scope reference: @scopeId
    if (input[i] === '@') {
      i++;
      let id = '';
      while (i < input.length && /[\w\-]/.test(input[i])) {
        id += input[i++];
      }
      if (id.length === 0) {
        throw new ParseError('Expected scope id after @', i);
      }
      tokens.push({ type: 'scope', id });
      continue;
    }

    // String: "..." or '...'
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i++];
      let value = '';
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          i++;
          switch (input[i]) {
            case 'n': value += '\n'; break;
            case 't': value += '\t'; break;
            case '\\': value += '\\'; break;
            default: value += input[i];
          }
        } else {
          value += input[i];
        }
        i++;
      }
      if (i >= input.length) {
        throw new ParseError('Unterminated string', i);
      }
      i++; // Skip closing quote
      tokens.push({ type: 'string', value });
      continue;
    }

    // Number
    if (/[\d\-]/.test(input[i])) {
      let numStr = '';
      if (input[i] === '-') {
        numStr += input[i++];
      }
      while (i < input.length && /[\d\.]/.test(input[i])) {
        numStr += input[i++];
      }
      if (numStr === '-' || numStr === '.') {
        throw new ParseError('Invalid number', i);
      }
      tokens.push({ type: 'number', value: parseFloat(numStr) });
      continue;
    }

    // Parentheses and comma
    if (input[i] === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (input[i] === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (input[i] === ',') {
      tokens.push({ type: 'comma' });
      i++;
      continue;
    }

    // Identifier (including keywords)
    if (/[a-zA-Z_]/.test(input[i])) {
      let ident = '';
      while (i < input.length && /[\w]/.test(input[i])) {
        ident += input[i++];
      }

      // Check for keywords
      if (ident === 'true') {
        tokens.push({ type: 'boolean', value: true });
      } else if (ident === 'false') {
        tokens.push({ type: 'boolean', value: false });
      } else if (ident === 'null') {
        tokens.push({ type: 'null' });
      } else {
        tokens.push({ type: 'identifier', value: ident });
      }
      continue;
    }

    throw new ParseError(`Unexpected character: ${input[i]}`, i);
  }

  return tokens;
}

// Parser
export function parseExpression(input: string): Expression {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    return '';
  }

  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function consume(): Token {
    return tokens[pos++];
  }

  function parseExpr(): Expression {
    const token = peek();
    if (!token) {
      throw new ParseError('Unexpected end of input', pos);
    }

    switch (token.type) {
      case 'number':
        consume();
        return token.value;

      case 'string':
        consume();
        return token.value;

      case 'boolean':
        consume();
        return token.value;

      case 'null':
        consume();
        return null;

      case 'variable':
        consume();
        return variable(token.name);

      case 'scope':
        consume();
        return scopeRef(token.id);

      case 'identifier': {
        consume();
        const name = token.value;

        // Check if followed by (
        if (peek()?.type === 'lparen') {
          consume(); // (
          const args: Expression[] = [];

          // Parse arguments
          while (peek() && peek()!.type !== 'rparen') {
            args.push(parseExpr());

            if (peek()?.type === 'comma') {
              consume();
            } else if (peek()?.type !== 'rparen') {
              throw new ParseError('Expected , or )', pos);
            }
          }

          if (peek()?.type !== 'rparen') {
            throw new ParseError('Expected )', pos);
          }
          consume(); // )

          return constructor(name, ...args);
        }

        // 0-ary constructor
        return constructor(name);
      }

      default:
        throw new ParseError(`Unexpected token: ${token.type}`, pos);
    }
  }

  const result = parseExpr();

  // Check for leftover tokens
  if (pos < tokens.length) {
    throw new ParseError('Unexpected tokens after expression', pos);
  }

  return result;
}

// Try to parse, return null on failure
export function tryParseExpression(input: string): Expression | null {
  try {
    return parseExpression(input);
  } catch {
    return null;
  }
}

// Check if input looks like a partial constructor call
export function getPartialConstructor(input: string): { name: string; argCount: number; inArg: boolean } | null {
  const trimmed = input.trim();

  // Match: name( or name(arg, or name(arg, arg,
  const match = trimmed.match(/^([a-zA-Z_]\w*)\s*\((.*)$/);
  if (!match) return null;

  const name = match[1];
  const argsStr = match[2];

  // Count commas to determine argument position
  let argCount = 0;
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (const ch of argsStr) {
    if (inString) {
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) argCount++;
  }

  // If there's content after the last comma (or no comma), we're in an argument
  const lastComma = argsStr.lastIndexOf(',');
  const afterLastComma = lastComma === -1 ? argsStr : argsStr.slice(lastComma + 1);
  const inArg = afterLastComma.trim().length > 0 || argsStr.length === 0;

  return { name, argCount, inArg };
}
