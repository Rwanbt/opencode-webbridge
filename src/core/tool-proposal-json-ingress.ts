/** G138: a byte/string PROCESS BOUNDARY, not a grant or a tool executor. */
import { validateToolProposal, type ToolScope, type ValidateResult } from './tool-proposal.js';

export type IngressReason = 'input-type' | 'oversized' | 'invalid-utf8' |
  'invalid-json' | 'invalid-unicode' | 'duplicate-key' | 'dangerous-key' |
  'depth-limit' | 'token-limit' | 'string-limit';
export type IngressResult = ValidateResult | { readonly ok: false; readonly reason: IngressReason };

const MAX_BYTES = 16_384;
const MAX_TOKENS = 256;
const MAX_DEPTH = 12;
const MAX_STRING = 8_192;
const WHITESPACE = new Set([' ', '\t', '\r', '\n']);
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const hex4 = /^[0-9a-fA-F]{4}$/;
const numeric = (v: string): boolean => v >= '0' && v <= '9';
const wellFormed = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const a = s.charCodeAt(i);
    if (a >= 0xdc00 && a <= 0xdfff) return false;
    if (a >= 0xd800 && a <= 0xdbff) {
      const b = s.charCodeAt(++i);
      if (!(b >= 0xdc00 && b <= 0xdfff)) return false;
    }
  }
  return true;
};
const unicodeSafe = (s: string): boolean => wellFormed(s) &&
  !/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u.test(s) &&
  ![...s].some((ch) => {
    const code = ch.codePointAt(0)!;
    return (code >= 0xfdd0 && code <= 0xfdef) || (code & 0xfffe) === 0xfffe;
  });

class Invalid extends Error {
  constructor(readonly reason: IngressReason) { super('invalid G138 serialized proposal'); }
}
const deny = (reason: IngressReason): never => { throw new Invalid(reason); };

/** First scan every JSON token before JSON.parse can discard duplicate keys. */
class Scanner {
  private pos = 0;
  private tokens = 0;
  constructor(private readonly s: string) {}

  private space(): void {
    while (WHITESPACE.has(this.s[this.pos] ?? '')) this.pos++;
  }
  private token(): void {
    if (++this.tokens > MAX_TOKENS) deny('token-limit');
  }
  private exact(word: string): void {
    if (this.s.slice(this.pos, this.pos + word.length) !== word) deny('invalid-json');
    this.pos += word.length;
  }
  private str(): string {
    if (this.s[this.pos] !== '"') deny('invalid-json');
    const start = this.pos++;
    let closed = false;
    while (this.pos < this.s.length) {
      const c = this.s.charCodeAt(this.pos++);
      if (c === 34) { closed = true; break; }
      if (c < 32) deny('invalid-json');
      if (c === 92) {
        const escaped = this.s[this.pos++];
        if (escaped === 'u') {
          const digits = this.s.slice(this.pos, this.pos + 4);
          if (!hex4.test(digits)) deny('invalid-json');
          this.pos += 4;
        } else if (!escaped || !'"\\/bfnrt'.includes(escaped)) deny('invalid-json');
      }
      if (this.pos - start > MAX_STRING * 6 + 2) deny('string-limit');
    }
    if (!closed) deny('invalid-json');
    let decoded: string;
    try { decoded = JSON.parse(this.s.slice(start, this.pos)) as string; }
    catch { return deny('invalid-json'); }
    if (decoded.length > MAX_STRING) deny('string-limit');
    if (!unicodeSafe(decoded)) deny('invalid-unicode');
    return decoded;
  }
  private number(): void {
    const start = this.pos;
    if (this.s[this.pos] === '-') this.pos++;
    if (this.s[this.pos] === '0') this.pos++;
    else {
      if (!this.s[this.pos] || this.s[this.pos]! < '1' || this.s[this.pos]! > '9')
        deny('invalid-json');
      while (numeric(this.s[this.pos] ?? '')) this.pos++;
    }
    if (this.s[this.pos] === '.') {
      this.pos++;
      if (!numeric(this.s[this.pos] ?? '')) deny('invalid-json');
      while (numeric(this.s[this.pos] ?? '')) this.pos++;
    }
    if (this.s[this.pos] === 'e' || this.s[this.pos] === 'E') {
      this.pos++;
      if (this.s[this.pos] === '+' || this.s[this.pos] === '-') this.pos++;
      if (!numeric(this.s[this.pos] ?? '')) deny('invalid-json');
      while (numeric(this.s[this.pos] ?? '')) this.pos++;
    }
    if (!Number.isFinite(Number(this.s.slice(start, this.pos)))) deny('invalid-json');
  }
  private value(depth: number): void {
    this.space(); this.token();
    const c = this.s[this.pos];
    if (c === '"') { this.str(); return; }
    if (c === 'n') { this.exact('null'); return; }
    if (c === 't') { this.exact('true'); return; }
    if (c === 'f') { this.exact('false'); return; }
    if (c === '-' || numeric(c ?? '')) { this.number(); return; }
    if (c !== '{' && c !== '[') deny('invalid-json');
    if (depth >= MAX_DEPTH) deny('depth-limit');
    this.pos++;
    this.space();
    const end = c === '{' ? '}' : ']';
    if (this.s[this.pos] === end) { this.pos++; return; }
    const keys = c === '{' ? new Set<string>() : undefined;
    for (;;) {
      if (keys) {
        this.token();
        const key = this.str();
        if (DANGEROUS_KEYS.has(key)) deny('dangerous-key');
        if (keys.has(key)) deny('duplicate-key');
        keys.add(key);
        this.space();
        if (this.s[this.pos++] !== ':') deny('invalid-json');
      }
      this.value(depth + 1);
      this.space();
      if (this.s[this.pos] === end) { this.pos++; return; }
      if (this.s[this.pos++] !== ',') deny('invalid-json');
      this.space();
    }
  }
  scan(): void {
    this.value(0);
    this.space();
    if (this.pos !== this.s.length) deny('invalid-json');
  }
}

// Intrinsic typed-array methods inspect internal slots, NOT user-supplied getters.
// ArrayBuffer.isView(proxy) is false, so hostile Proxy traps are not visited.
const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
const brand = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)?.get;
const byteLength = Object.getOwnPropertyDescriptor(typed, 'byteLength')?.get;

/** Never accept an object proposal. Uint8Array/Buffer bytes are snapshotted first. */
export function ingestToolProposalJSON(wire: unknown, hostScope: ToolScope): IngressResult {
  const refused = (reason: IngressReason): IngressResult => Object.freeze({ ok: false, reason });
  let text: string;
  if (typeof wire === 'string') {
    if (wire.length > MAX_BYTES) return refused('oversized');
    if (!wellFormed(wire)) return refused('invalid-unicode');
    if (Buffer.byteLength(wire, 'utf8') > MAX_BYTES) return refused('oversized');
    text = wire;
  } else if (ArrayBuffer.isView(wire)) {
    try {
      if (brand?.call(wire) !== 'Uint8Array') return refused('input-type');
      const length = byteLength?.call(wire) as number;
      if (length > MAX_BYTES) return refused('oversized');
      const snapshot = new Uint8Array(length);
      Uint8Array.prototype.set.call(snapshot, wire as Uint8Array); // slots only, no source .get
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot);
    } catch { return refused('invalid-utf8'); }
  } else return refused('input-type');

  try {
    new Scanner(text).scan();
    const data: unknown = JSON.parse(text);
    const vetted = validateToolProposal(data, hostScope);
    return Object.freeze(vetted);
  } catch (error) {
    return refused(error instanceof Invalid ? error.reason : 'invalid-json');
  }
}
