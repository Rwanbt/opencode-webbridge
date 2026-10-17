/**
 * Structured, untrusted tool proposal produced from web/model output.
 *
 * A proposal is NEVER an execution. It must pass strict schema validation,
 * scope binding, and (for the first phase) be read-only before any native
 * tool can be considered. Mutable actions are rejected by this module.
 */

import { assertOpaqueID } from './browser-port.js';
import { normalizeWorkspacePath } from './workspace-path.js';

export type ToolScope = {
  readonly sessionID: string;
  readonly agentID: string;
  readonly turnID: string;
  readonly workspaceID: string;
  readonly callID: string;
};

export type ReadOnlyAction = 'file.read' | 'git.status' | 'git.diff' | 'git.log';

export type ToolProposal = {
  readonly version: 1;
  readonly action: ReadOnlyAction;
  readonly args: Readonly<Record<string, unknown>>;
  readonly provenance: ToolScope;
};

export type ValidateResult =
  | { readonly ok: true; readonly proposal: ToolProposal }
  | { readonly ok: false; readonly reason:
      | 'not-object'
      | 'bad-version'
      | 'unknown-action'
      | 'mutable-action'
      | 'bad-args'
      | 'bad-provenance'
      | 'scope-mismatch'
      | 'path-traversal'
      | 'oversized' };

const READ_ONLY_ACTIONS: ReadonlySet<string> = new Set(['file.read', 'git.status', 'git.diff', 'git.log']);
const MUTABLE_ACTIONS: ReadonlySet<string> = new Set([
  'file.write', 'file.delete', 'terminal.exec', 'git.commit', 'git.push',
  'git.reset', 'git.checkout', 'agent.spawn', 'agent.delegate',
]);
const MAX_ARGS_BYTES = 8_192;

function isOpaque(v: unknown): v is string {
  try { assertOpaqueID(v as string, 'x'); return true; } catch { return false; }
}

function safePath(p: unknown): p is string {
  // Strict workspace-relative contract: UNC/absolute/drive forms, traversal,
  // ADS colons, trailing dot/space aliasing, device names and control
  // characters are all rejected; benign separator forms are canonicalized.
  return normalizeWorkspacePath(p) !== null;
}

function validateArgs(action: ReadOnlyAction, args: unknown): args is Readonly<Record<string, unknown>> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  const a = args as Record<string, unknown>;
  switch (action) {
    case 'file.read':
      return typeof a.path === 'string' && safePath(a.path) &&
        (a.encoding === undefined || a.encoding === 'utf8');
    case 'git.status':
    case 'git.log':
      return a.limit === undefined || (Number.isSafeInteger(a.limit) && (a.limit as number) > 0 && (a.limit as number) <= 1000);
    case 'git.diff':
      return (a.path === undefined || safePath(a.path)) &&
        (a.staged === undefined || typeof a.staged === 'boolean');
    default:
      return false;
  }
}

export function isReadOnlyAction(action: unknown): action is ReadOnlyAction {
  return typeof action === 'string' && READ_ONLY_ACTIONS.has(action);
}

export function isMutableAction(action: unknown): boolean {
  return typeof action === 'string' && MUTABLE_ACTIONS.has(action);
}

export function validateToolProposal(raw: unknown, scope: ToolScope): ValidateResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not-object' };
  const r = raw as Record<string, unknown>;

  if (r.version !== 1) return { ok: false, reason: 'bad-version' };

  const action = r.action;
  if (typeof action !== 'string') return { ok: false, reason: 'unknown-action' };
  if (isMutableAction(action)) return { ok: false, reason: 'mutable-action' };
  if (!isReadOnlyAction(action)) return { ok: false, reason: 'unknown-action' };

  // Size guard before deeper parsing.
  let size = 0;
  try { size = JSON.stringify(r.args ?? {}).length; } catch { return { ok: false, reason: 'bad-args' }; }
  if (size > MAX_ARGS_BYTES) return { ok: false, reason: 'oversized' };

  if (!validateArgs(action, r.args)) return { ok: false, reason: 'bad-args' };

  const prov = r.provenance;
  if (!prov || typeof prov !== 'object' || Array.isArray(prov)) return { ok: false, reason: 'bad-provenance' };
  const p = prov as Record<string, unknown>;
  const fields: (keyof ToolScope)[] = ['sessionID', 'agentID', 'turnID', 'workspaceID', 'callID'];
  for (const f of fields) {
    if (!isOpaque(p[f])) return { ok: false, reason: 'bad-provenance' };
  }

  // Scope binding: proposal must match the independently known session/agent/turn/workspace/call.
  if (p.sessionID !== scope.sessionID || p.agentID !== scope.agentID ||
      p.turnID !== scope.turnID || p.workspaceID !== scope.workspaceID ||
      p.callID !== scope.callID) {
    return { ok: false, reason: 'scope-mismatch' };
  }

  // Path traversal check (defence in depth, already in validateArgs) and
  // canonicalization: the validated proposal only ever carries the strict
  // posix relative form, never a raw caller-supplied string.
  const rawArgs = r.args as Record<string, unknown>;
  const args: Record<string, unknown> = { ...rawArgs };
  if (action === 'file.read' || (action === 'git.diff' && rawArgs.path !== undefined)) {
    const normalized = normalizeWorkspacePath(rawArgs.path);
    if (normalized === null) return { ok: false, reason: 'path-traversal' };
    args.path = normalized;
  }

  return {
    ok: true,
    proposal: {
      version: 1,
      action,
      args: Object.freeze(args),
      provenance: {
        sessionID: p.sessionID as string,
        agentID: p.agentID as string,
        turnID: p.turnID as string,
        workspaceID: p.workspaceID as string,
        callID: p.callID as string,
      },
    },
  };
}
