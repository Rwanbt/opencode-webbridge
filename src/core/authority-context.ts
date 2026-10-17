/**
 * Authority context tuple for a single browser read/effect.
 *
 * Assembled from INDEPENDENTLY known values (never trusted from the caller).
 * Completeness is required: a missing field fails closed.
 */

import { assertOpaqueID } from './browser-port.js';

export interface AuthorityContext {
  readonly pluginID: string;
  readonly pluginGeneration: string;
  readonly agentID: string;
  readonly sessionID: string;
  readonly workspaceID: string;
  readonly worktreeID: string;
  readonly turnID: string;
  readonly callID: string;
  readonly connectionID: string;
  readonly connectionGeneration: string;
  readonly tabID: string;
  readonly tabGeneration: string;
  readonly action: string;
  readonly policyRevision: string;
  readonly authorityEpoch: string;
  readonly ticketID: string;
  readonly ticketNonce: string;
  readonly deadline: number;
}

export type AuthorityBuildResult =
  | { readonly ok: true; readonly context: AuthorityContext }
  | { readonly ok: false; readonly reason: string };

const OPAQUE = /^[A-Za-z0-9_.:-]{1,128}$/;

function isOpaque(v: unknown): v is string {
  return typeof v === 'string' && OPAQUE.test(v);
}

function isDeadline(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

const REQUIRED_FIELDS: (keyof AuthorityContext)[] = [
  'pluginID', 'pluginGeneration', 'agentID', 'sessionID', 'workspaceID', 'worktreeID',
  'turnID', 'callID', 'connectionID', 'connectionGeneration', 'tabID', 'tabGeneration',
  'action', 'policyRevision', 'authorityEpoch', 'ticketID', 'ticketNonce', 'deadline',
];

export function buildAuthorityContext(input: Partial<AuthorityContext>): AuthorityBuildResult {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'invalid:shape' };
  // Host-owned messages must already be parsed into plain data. Accessor or
  // unexpected fields can otherwise run arbitrary web JS while validating.
  let data: Record<string, unknown>;
  try {
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return { ok: false, reason: 'invalid:shape' };
    const keys = Reflect.ownKeys(input);
    if (keys.some((key) => typeof key !== 'string' || !REQUIRED_FIELDS.includes(key as keyof AuthorityContext)))
      return { ok: false, reason: 'invalid:shape' };
    const absent = REQUIRED_FIELDS.find((f) => !keys.includes(f));
    if (absent) return { ok: false, reason: `missing:${absent}` };
    if (keys.length !== REQUIRED_FIELDS.length) return { ok: false, reason: 'invalid:shape' };
    data = Object.create(null) as Record<string, unknown>;
    for (const f of REQUIRED_FIELDS) {
      const d = Object.getOwnPropertyDescriptor(input, f);
      if (!d) return { ok: false, reason: `missing:${f}` };
      if (!('value' in d)) return { ok: false, reason: `invalid:accessor:${f}` };
      data[f] = d.value;
    }
  } catch {
    return { ok: false, reason: 'invalid:shape' };
  }
  for (const f of REQUIRED_FIELDS) {
    if (data[f] === undefined || data[f] === null) {
      return { ok: false, reason: `missing:${f}` };
    }
  }
  // All string fields must be opaque (no free-form injection).
  for (const f of REQUIRED_FIELDS) {
    if (f === 'deadline') continue;
    const v = data[f];
    if (!isOpaque(v)) return { ok: false, reason: `invalid:${f}` };
  }
  if (!isDeadline(data.deadline)) return { ok: false, reason: 'invalid:deadline' };

  // Validate IDs via the shared opaque checker where applicable (stricter subset).
  try {
    assertOpaqueID(data.sessionID as string, 'sessionID');
    assertOpaqueID(data.turnID as string, 'turnID');
    assertOpaqueID(data.callID as string, 'callID');
    assertOpaqueID(data.tabID as string, 'tabID');
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  const context: AuthorityContext = Object.freeze(data) as unknown as AuthorityContext;
  return { ok: true, context };
}

export function isExpired(ctx: AuthorityContext, now: number): boolean {
  if (!Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(ctx.deadline) || ctx.deadline <= 0) return true;
  return now >= ctx.deadline;
}

export function sameAuthority(a: AuthorityContext, b: AuthorityContext): boolean {
  return a.pluginID === b.pluginID && a.pluginGeneration === b.pluginGeneration &&
    a.agentID === b.agentID && a.sessionID === b.sessionID &&
    a.workspaceID === b.workspaceID && a.worktreeID === b.worktreeID &&
    a.turnID === b.turnID && a.callID === b.callID &&
    a.connectionID === b.connectionID && a.connectionGeneration === b.connectionGeneration &&
    a.tabID === b.tabID && a.tabGeneration === b.tabGeneration &&
    a.action === b.action && a.policyRevision === b.policyRevision &&
    a.authorityEpoch === b.authorityEpoch && a.ticketID === b.ticketID &&
    a.ticketNonce === b.ticketNonce && a.deadline === b.deadline;
}
