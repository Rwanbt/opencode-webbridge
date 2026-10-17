import { WEB_PROVIDER_CATALOG, type WebProviderID } from '../catalog.js';
import { assertOpaqueID } from '../core/browser-port.js';
import { readPlainFields } from '../core/adapter-contract.js';

/** Fixture-only state. No DOM selectors, cookies, network or real provider access. */
export type OfflinePhase = 'disconnected' | 'login-required' | 'fixture-ready' |
  'streaming' | 'finished' | 'uncertain';

export type OfflineBinding = Readonly<{
  providerID: WebProviderID;
  sessionID: string;
  accountRef: string;
  tabID: string;
  connectionID: string;
  generation: number;
}>;

export type OfflineObservation = Readonly<{
  binding: OfflineBinding;
  signedIn: boolean;
}>;

const BINDING_FIELDS = ['providerID', 'sessionID', 'accountRef', 'tabID', 'connectionID', 'generation'] as const;
const OPAQUE_FIELDS = ['sessionID', 'accountRef', 'tabID', 'connectionID'] as const;
const OBSERVATION_FIELDS = ['binding', 'signedIn'] as const;
const FRAGMENT_FIELDS = ['turnID', 'seq', 'text'] as const;
const EVIDENCE_FIELDS = ['turnID', 'outcome', 'hash'] as const;
const OUTCOMES = ['observed-applied', 'observed-not-applied'] as const;

/** State machine only, not an automated service adapter or a readiness grant. */
export class OfflineAdapterSession {
  private binding?: OfflineBinding;
  private phase: OfflinePhase = 'disconnected';
  private readonly spent = new Set<string>();
  private turn?: { id: string; seq: number; text: string };

  constructor(readonly providerID: WebProviderID) {
    if (!WEB_PROVIDER_CATALOG.some((provider) => provider.id === providerID))
      throw new Error('unknown fixture provider');
  }

  snapshot() {
    return Object.freeze({ providerID: this.providerID, phase: this.phase,
      sessionID: this.binding?.sessionID, accountRef: this.binding?.accountRef,
      tabID: this.binding?.tabID, generation: this.binding?.generation,
      turnID: this.turn?.id, seq: this.turn?.seq });
  }

  /**
   * Descriptor-only binding read. Hostile bindings (getters, proxies, toJSON,
   * hidden or symbol keys, class instances, credential-like or extra fields)
   * are refused without executing anything, and only opaque identifiers are
   * stored — never cookies, tokens or login material.
   */
  private readBinding(input: unknown): OfflineBinding {
    const parsed = readPlainFields(input, BINDING_FIELDS);
    if (!parsed.ok) throw new Error(`invalid fixture binding or credential-like field: ${parsed.reason}`);
    if (parsed.fields.get('providerID') !== this.providerID)
      throw new Error('invalid fixture binding or credential-like field: provider mismatch');
    const generation = parsed.fields.get('generation');
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 0)
      throw new Error('invalid fixture binding or credential-like field: invalid generation');
    const sessionID = parsed.fields.get('sessionID');
    const accountRef = parsed.fields.get('accountRef');
    const tabID = parsed.fields.get('tabID');
    const connectionID = parsed.fields.get('connectionID');
    const identity = { sessionID, accountRef, tabID, connectionID };
    for (const field of OPAQUE_FIELDS) {
      try {
        assertOpaqueID(identity[field] as string, field);
      } catch {
        throw new Error(`invalid fixture binding or credential-like field: ${field} must be an opaque identifier`);
      }
    }
    return Object.freeze({
      providerID: this.providerID,
      sessionID: sessionID as string,
      accountRef: accountRef as string,
      tabID: tabID as string,
      connectionID: connectionID as string,
      generation,
    });
  }

  private owned(actual: OfflineBinding): OfflineBinding {
    const registered = this.binding;
    if (!registered || registered.providerID !== actual.providerID ||
      registered.sessionID !== actual.sessionID || registered.accountRef !== actual.accountRef ||
      registered.tabID !== actual.tabID || registered.connectionID !== actual.connectionID ||
      registered.generation !== actual.generation) {
      throw new Error('offline adapter owner, account or generation mismatch');
    }
    return registered;
  }

  /** Read the raw input safely first, then compare it against the registered owner. */
  private requireBound(input: unknown): OfflineBinding {
    return this.owned(this.readBinding(input));
  }

  pair(input: OfflineBinding): void {
    if (this.binding || this.phase !== 'disconnected') throw new Error('fixture already bound');
    this.binding = this.readBinding(input);
    this.phase = 'login-required';
  }

  /** Host-supplied MANUAL status observation, never a credential or login automation. */
  observe(input: OfflineObservation): void {
    const parsed = readPlainFields(input, OBSERVATION_FIELDS);
    if (!parsed.ok || typeof parsed.fields.get('signedIn') !== 'boolean') {
      throw new Error(`invalid manual observation: ${parsed.ok ? 'signedIn must be boolean' : parsed.reason}`);
    }
    this.requireBound(parsed.fields.get('binding'));
    if (this.phase === 'streaming' || this.phase === 'uncertain')
      throw new Error('in-flight or uncertain turn requires reconciliation');
    this.phase = parsed.fields.get('signedIn') === true ? 'fixture-ready' : 'login-required';
  }

  start(binding: OfflineBinding, turnID: string): void {
    this.requireBound(binding);
    assertOpaqueID(turnID, 'turnID');
    if (this.phase !== 'fixture-ready') throw new Error('offline adapter not ready for fixture turn');
    if (this.spent.has(turnID) || this.spent.size >= 64)
      throw new Error('fixture turn already spent: reconcile before retry');
    this.spent.add(turnID); // Consume before any simulated effect.
    this.turn = { id: turnID, seq: 0, text: '' };
    this.phase = 'streaming';
  }

  progress(binding: OfflineBinding, event: { turnID: string; seq: number; text: string }): void {
    this.requireBound(binding);
    const parsed = readPlainFields(event, FRAGMENT_FIELDS);
    if (!parsed.ok) throw new Error(`offline adapter fragment rejected: ${parsed.reason}`);
    const turnID = parsed.fields.get('turnID');
    const seq = parsed.fields.get('seq');
    const text = parsed.fields.get('text');
    if (this.phase !== 'streaming' || !this.turn || turnID !== this.turn.id)
      throw new Error('offline adapter turn not streaming or wrong identity');
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq !== this.turn.seq + 1)
      throw new Error('offline adapter fragment out of order');
    if (typeof text !== 'string' || !text || text.length > 4096 ||
      this.turn.text.length + text.length > 16_000 || seq > 63)
      throw new Error('offline adapter fragment out of bounds');
    this.turn.seq = seq;
    this.turn.text += text;
  }

  finish(binding: OfflineBinding, turnID: string, finalText: string): string {
    this.requireBound(binding);
    if (this.phase !== 'streaming' || !this.turn || this.turn.id !== turnID || !this.turn.seq ||
      finalText !== this.turn.text) throw new Error('offline adapter terminal mismatch');
    this.phase = 'finished';
    return finalText; // Test-only text; never parsed as an effect or tool instruction.
  }

  interrupt(binding: OfflineBinding): void {
    this.requireBound(binding);
    if (this.phase !== 'streaming') throw new Error('no fixture turn to interrupt');
    this.phase = 'uncertain'; // Never claim that an already-issued effect was cancelled.
  }

  reconnect(previous: OfflineBinding, next: OfflineBinding): void {
    const current = this.requireBound(previous);
    if (this.phase === 'streaming' || this.phase === 'uncertain')
      throw new Error('reconcile uncertain fixture effect before reconnect');
    const updated = this.readBinding(next);
    if (updated.sessionID !== current.sessionID || updated.accountRef !== current.accountRef ||
      updated.tabID !== current.tabID || updated.generation <= current.generation ||
      updated.connectionID === current.connectionID)
      throw new Error('fixture reconnection owner or generation mismatch');
    this.binding = updated;
    this.turn = undefined; // Old-turn state never survives a reconnect.
    this.phase = 'login-required';
  }

  /** No automatic retry even after an operator observed the final outcome. */
  reconcile(binding: OfflineBinding, evidence: { turnID: string; outcome: 'observed-applied' | 'observed-not-applied'; hash: string }): void {
    this.requireBound(binding);
    const parsed = readPlainFields(evidence, EVIDENCE_FIELDS);
    const turnID = parsed.ok ? parsed.fields.get('turnID') : undefined;
    const outcome = parsed.ok ? parsed.fields.get('outcome') : undefined;
    const hash = parsed.ok ? parsed.fields.get('hash') : undefined;
    if (!parsed.ok || this.phase !== 'uncertain' || !this.turn || this.turn.id !== turnID ||
      typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) ||
      !OUTCOMES.includes(outcome as (typeof OUTCOMES)[number])) {
      throw new Error(`invalid operator reconciliation evidence${parsed.ok ? '' : `: ${parsed.reason}`}`);
    }
    this.turn = undefined; // Explicit manual observation is required again.
    this.phase = 'login-required';
  }
}
