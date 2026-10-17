import { createHash } from 'node:crypto';
import { assertOpaqueID, type TabClaim } from './browser-port.js';
import type { DurableRelayJournal } from './durable-relay-journal.js';

/** Tool proposals from web output are data, never OpenCode authorizations. */
export type NativeScope = TabClaim & { readonly agentID: string; readonly worktreeRef: string;
  /** Current turn validated by OpenCode, never taken from browser output. */
  readonly turnID: string };
export type ToolProposal = {
  readonly version: 1;
  readonly kind: 'tool_proposal';
  readonly sessionID: string;
  readonly agentID: string;
  readonly worktreeRef: string;
  readonly turnID: string;
  readonly operationID: string;
  readonly tool: { readonly name: string; readonly arguments: Readonly<Record<string, unknown>> };
};

const exact = (obj: Record<string, unknown>, fields: readonly string[]): boolean =>
  Reflect.ownKeys(obj).length === fields.length && fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(obj, field);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

/** Reject exotic/cyclic/prototype-tainted and oversized arguments BEFORE any permission call. */
function safeJSON(value: unknown, seen = new Set<object>(), depth = 0, budget = { nodes: 0 }): void {
  if (++budget.nodes > 128 || depth > 8) throw new Error('tool arguments not bounded plain JSON');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string' && value.length <= 4_096) return;
  if (typeof value !== 'object' || seen.has(value)) throw new Error('tool arguments not bounded plain JSON');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length || Reflect.ownKeys(value).length !== value.length + 1) {
      throw new Error('tool arguments not bounded plain JSON');
    }
    // Iterating an untrusted array invokes accessor indices (and a mutable
    // Symbol.iterator). Never execute either while validating a tool proposal.
    for (let i = 0; i < value.length; i++) {
      const item = Object.getOwnPropertyDescriptor(value, String(i));
      if (!item?.enumerable || !Object.hasOwn(item, 'value')) {
        throw new Error('tool arguments not bounded plain JSON');
      }
      safeJSON(item.value, seen, depth + 1, budget);
    }
  } else {
    if (!plain(value)) throw new Error('tool arguments not bounded plain JSON');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new Error('tool arguments not bounded plain JSON');
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (key === '__proto__' || key === 'prototype' || key === 'constructor' || key.length > 128) {
        throw new Error('tool arguments contain forbidden fields');
      }
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error('tool arguments not bounded plain JSON');
      }
      safeJSON(descriptor.value, seen, depth + 1, budget);
    }
  }
  seen.delete(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

/** Does not extract tool requests from arbitrary web text, Markdown or DOM. */
export function parseToolProposal(raw: unknown, scope: NativeScope, tools?: ReadonlySet<string>): ToolProposal {
  if (!plain(raw) || !exact(raw,
    ['version', 'kind', 'sessionID', 'agentID', 'worktreeRef', 'turnID', 'operationID', 'tool'])) {
    throw new Error('expected explicit structured tool proposal with exact fields');
  }
  if (raw.version !== 1 || raw.kind !== 'tool_proposal') throw new Error('unsupported tool proposal version');
  for (const field of ['sessionID', 'agentID', 'worktreeRef', 'turnID', 'operationID'] as const) {
    assertOpaqueID(raw[field] as string, field);
  }
  if (raw.sessionID !== scope.sessionID || raw.agentID !== scope.agentID ||
    raw.worktreeRef !== scope.worktreeRef || raw.turnID !== scope.turnID) {
    throw new Error('tool proposal binding mismatch');
  }
  if (!plain(raw.tool) || !exact(raw.tool, ['name', 'arguments']) ||
    typeof raw.tool.name !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(raw.tool.name)) {
    throw new Error('invalid tool name or fields');
  }
  if (tools && !tools.has(raw.tool.name)) throw new Error('tool is not registered in native OpenCode');
  if (!plain(raw.tool.arguments)) throw new Error('tool arguments must be plain JSON');
  safeJSON(raw.tool.arguments);
  const encoded = JSON.stringify(raw);
  if (encoded.length > 16_000) throw new Error('tool proposal too large');
  // The browser's mutable object is NEVER handed to either native authority or
  // executor. Both see one detached, deeply frozen snapshot of the same action.
  return deepFreeze(JSON.parse(encoded) as ToolProposal);
}

export type NativeAuthorization = (proposal: ToolProposal) => Promise<boolean>;
export type NativeExecutor<T> = (proposal: ToolProposal) => Promise<T>;

/**
 * Integration contract ONLY. Caller must wire native OpenCode permission + registered
 * tool-schema validation; this module does not grant permissions or publish tools.
 */
export class NativeToolHandoff {
  private readonly scope: NativeScope;
  constructor(scope: NativeScope, private readonly journal: DurableRelayJournal,
    private readonly registered: ReadonlySet<string>,
    private readonly validateArguments: (name: string, args: Readonly<Record<string, unknown>>) => boolean) {
    for (const [key, value] of Object.entries(scope)) assertOpaqueID(value, key);
    this.scope = Object.freeze({ ...scope });
    journal.assertBinding(this.scope);
  }

  async dispatch<T>(raw: unknown, nativeAuthorize: NativeAuthorization,
    nativeExecute: NativeExecutor<T>): Promise<{ status: 'denied' } | { status: 'completed'; value: T }> {
    const request = parseToolProposal(raw, this.scope, this.registered);
    // TypeScript types are not runtime authority. A Promise or arbitrary truthy
    // object must never turn an unvalidated web proposal into a native effect.
    if (this.validateArguments(request.tool.name, request.tool.arguments) !== true) {
      throw new Error('tool arguments violate native schema');
    }
    // Different agents/worktrees cannot accidentally share the same operation ID.
    const durableID = createHash('sha256').update(JSON.stringify([
      this.scope.sessionID, this.scope.providerID, this.scope.tabID, this.scope.accountRef,
      this.scope.agentID, this.scope.worktreeRef, request.operationID,
    ])).digest('hex');
    this.journal.prepare(durableID);
    let allowed = false;
    try { allowed = await nativeAuthorize(request) === true; }
    catch { this.journal.cancelled(durableID); throw new Error('native permission unavailable'); }
    if (!allowed) { this.journal.cancelled(durableID); return { status: 'denied' }; }
    // Native registrations can be revoked while asynchronous permission UI is
    // open. Treat a missing or changed schema gate as denial before leasing.
    if (!this.registered.has(request.tool.name) ||
      this.validateArguments(request.tool.name, request.tool.arguments) !== true) {
      this.journal.cancelled(durableID);
      return { status: 'denied' };
    }
    // Durable lease BEFORE external terminal, filesystem, Git or sub-agent effects.
    this.journal.leased(durableID);
    try {
      const value = await nativeExecute(request);
      this.journal.settled(durableID);
      return { status: 'completed', value };
    } catch {
      // Execution may already have affected external state. Never retry it.
      throw new Error('native tool effect uncertain: reconcile before retry');
    }
  }
}
