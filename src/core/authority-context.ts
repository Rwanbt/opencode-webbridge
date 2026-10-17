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
  for (const f of REQUIRED_FIELDS) {
    if (input[f] === undefined || input[f] === null) {
      return { ok: false, reason: `missing:${f}` };
    }
  }
  // All string fields must be opaque (no free-form injection).
  for (const f of REQUIRED_FIELDS) {
    if (f === 'deadline') continue;
    const v = input[f];
    if (!isOpaque(v)) return { ok: false, reason: `invalid:${f}` };
  }
  if (!isDeadline(input.deadline)) return { ok: false, reason: 'invalid:deadline' };

  // Validate IDs via the shared opaque checker where applicable (stricter subset).
  try {
    assertOpaqueID(input.sessionID as string, 'sessionID');
    assertOpaqueID(input.turnID as string, 'turnID');
    assertOpaqueID(input.callID as string, 'callID');
    assertOpaqueID(input.tabID as string, 'tabID');
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  const context: AuthorityContext = {
    pluginID: input.pluginID as string,
    pluginGeneration: input.pluginGeneration as string,
    agentID: input.agentID as string,
    sessionID: input.sessionID as string,
    workspaceID: input.workspaceID as string,
    worktreeID: input.worktreeID as string,
    turnID: input.turnID as string,
    callID: input.callID as string,
    connectionID: input.connectionID as string,
    connectionGeneration: input.connectionGeneration as string,
    tabID: input.tabID as string,
    tabGeneration: input.tabGeneration as string,
    action: input.action as string,
    policyRevision: input.policyRevision as string,
    authorityEpoch: input.authorityEpoch as string,
    ticketID: input.ticketID as string,
    ticketNonce: input.ticketNonce as string,
    deadline: input.deadline as number,
  };
  return { ok: true, context };
}

export function isExpired(ctx: AuthorityContext, now: number): boolean {
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
    a.ticketNonce === b.ticketNonce;
}
