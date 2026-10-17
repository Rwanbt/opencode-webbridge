import type { Plugin } from '@opencode/plugin';
import { assertOpaqueID, type TabClaim } from './browser-port.js';

/** PR #75 proposal v1 extended to v2: bind the native workspace explicitly. */
export type ToolScope = TabClaim & { readonly workspaceID: string; readonly agentID: string;
  readonly worktreeRef: string; readonly turnID: string };
export type ToolProposal = {
  readonly version: 2; readonly kind: 'tool_proposal'; readonly sessionID: string;
  readonly workspaceID: string; readonly agentID: string; readonly worktreeRef: string;
  readonly turnID: string; readonly operationID: string;
  readonly tool: { readonly name: string; readonly arguments: Readonly<Record<string, unknown>> };
};

/** Inspect descriptors before reading ANY web-authored field; getters are never invoked. */
function safeJSON(value: unknown, seen = new Set<object>(), depth = 0, budget = { nodes: 0 }): void {
  if (++budget.nodes > 128 || depth > 8) throw new Error('proposal exceeds JSON bounds');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string' && value.length <= 4096) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value)) throw new Error('proposal must be plain JSON');
  if (Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype)) {
    throw new Error('proposal must be plain JSON');
  }
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value) && (keys.length !== value.length + 1 ||
    keys.some((key) => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key))))) {
    throw new Error('proposal must be dense JSON array');
  }
  for (const key of keys) {
    if (key === 'length' && Array.isArray(value)) continue;
    if (typeof key !== 'string' || key.length > 128 ||
      ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('proposal forbidden field');
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, 'value')) throw new Error('proposal accessors forbidden');
    safeJSON(d.value, seen, depth + 1, budget);
  }
  seen.delete(value);
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const scopeKeys = ['sessionID', 'workspaceID', 'agentID', 'worktreeRef', 'turnID'] as const;
const freezeJSON = (value: Record<string, unknown>): void => {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') freezeJSON(child as Record<string, unknown>);
  }
  Object.freeze(value);
};

/** No Markdown/text coercion or v1 fallback: missing workspace provenance is denied. */
export function parseOfflineToolProposal(raw: unknown, scope: ToolScope): ToolProposal {
  safeJSON(raw);
  if (!record(raw) || !exact(raw, ['version', 'kind', ...scopeKeys, 'operationID', 'tool']) ||
    raw.version !== 2 || raw.kind !== 'tool_proposal') throw new Error('expected structured tool_proposal v2');
  for (const key of scopeKeys) {
    assertOpaqueID(scope[key], key);
    assertOpaqueID(raw[key] as string, key);
    if (raw[key] !== scope[key]) throw new Error(`tool proposal ${key} binding mismatch`);
  }
  assertOpaqueID(raw.operationID as string, 'operationID');
  if (!record(raw.tool) || !exact(raw.tool, ['name', 'arguments']) ||
    typeof raw.tool.name !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(raw.tool.name) ||
    !record(raw.tool.arguments)) throw new Error('invalid native tool descriptor');
  if (JSON.stringify(raw).length > 16_000) throw new Error('tool proposal too large');
  const detached = JSON.parse(JSON.stringify(raw)) as ToolProposal;
  freezeJSON(detached as unknown as Record<string, unknown>);
  return detached;
}

export interface NativeToolDefinition {
  readonly action: string;
  readonly validateArguments: (args: Readonly<Record<string, unknown>>) => boolean;
  /** Resolves exact native permission resources; NEVER accepts browser-authored permissions. */
  readonly resources: (args: Readonly<Record<string, unknown>>) => readonly string[];
}
type NativePermission = Pick<Plugin.Context['permission'], 'assert'>;

/** OFFLINE review with real SDK permission.assert interface; no executor, no grant token. */
export class OfflineToolPermissionReview {
  // Volatile review-only fence: no duplicate or concurrent consent for one operation.
  // Never evict entries to make an old operation replayable within this reviewer.
  private readonly attempted = new Set<string>();
  constructor(private readonly host: {
    readonly getScope: () => ToolScope;
    readonly authorityEpoch: () => string;
    readonly permission: NativePermission;
    readonly tools: ReadonlyMap<string, NativeToolDefinition>;
  }) {}

  async review(raw: unknown): Promise<{ readonly status: 'checked-only'; readonly operationID: string }> {
    const scope = Object.freeze({ ...this.host.getScope() });
    for (const key of ['providerID', 'tabID', 'accountRef'] as const) assertOpaqueID(scope[key], key);
    const epoch = this.host.authorityEpoch();
    if (!epoch) throw new Error('native authority epoch absent');
    const proposal = parseOfflineToolProposal(raw, scope);
    const definition = this.host.tools.get(proposal.tool.name);
    if (!definition || !definition.validateArguments(proposal.tool.arguments)) {
      throw new Error('native tool unknown or schema denied');
    }
    const resources = definition.resources(proposal.tool.arguments);
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(definition.action) ||
      !Array.isArray(resources) || resources.length < 1 || resources.length > 8 ||
      resources.some((r) => typeof r !== 'string' || !r.length || r === '*' || r.length > 4096)) {
      throw new Error('native permission mapping unavailable');
    }
    const current = () => {
      const now = this.host.getScope();
      if (this.host.authorityEpoch() !== epoch ||
        Object.keys(scope).some((key) => scope[key as keyof ToolScope] !== now[key as keyof ToolScope])) {
        throw new Error('native tool scope or authority revoked');
      }
      // Native-owned registry/policy may change during an interactive assert.
      // A stale permission check must never be represented as current review.
      if (this.host.tools.get(proposal.tool.name) !== definition ||
        definition.action !== input.action || !definition.validateArguments(proposal.tool.arguments)) {
        throw new Error('native tool permission mapping changed during review');
      }
      const mapped = definition.resources(proposal.tool.arguments);
      if (!Array.isArray(mapped) || mapped.length !== resources.length ||
        mapped.some((value, i) => value !== resources[i])) {
        throw new Error('native tool permission mapping changed during review');
      }
    };
    const input = {
      sessionID: scope.sessionID as Parameters<NativePermission['assert']>[0]['sessionID'],
      action: definition.action, resources: [...resources],
    };
    if (this.attempted.has(proposal.operationID)) throw new Error('native tool proposal replay denied');
    if (this.attempted.size >= 1024) throw new Error('native tool review capacity exhausted; operator recovery required');
    this.attempted.add(proposal.operationID); // before first await, including denied/uncertain prompts
    current();
    await this.host.permission.assert({ ...input, resources: [...resources] });
    current();
    await this.host.permission.assert({ ...input, resources: [...resources] }); // re-evaluate after consent
    current();
    return { status: 'checked-only', operationID: proposal.operationID };
  }
}
