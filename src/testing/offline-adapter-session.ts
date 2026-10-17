import { WEB_PROVIDER_CATALOG, type WebProviderID } from '../catalog.js';
import { assertOpaqueID } from '../core/browser-port.js';

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

/** Copy data descriptors only; no invocation of browser/fixture-authored getters. */
function dataRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) throw new Error('expected plain data record');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
    throw new Error('expected exact plain data record');
  }
  const copy: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('expected plain data record, no accessors');
    copy[field] = descriptor.value;
  }
  return copy;
}

const bindingFields = ['providerID', 'sessionID', 'accountRef', 'tabID', 'connectionID', 'generation'];

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

  private validate(binding: OfflineBinding): OfflineBinding {
    const raw = dataRecord(binding, bindingFields);
    if (raw.providerID !== this.providerID ||
      !Number.isSafeInteger(raw.generation) || (raw.generation as number) < 0) {
      throw new Error('invalid fixture binding or credential-like field');
    }
    for (const field of ['sessionID', 'accountRef', 'tabID', 'connectionID'] as const)
      assertOpaqueID(raw[field] as string, field);
    return Object.freeze(raw) as unknown as OfflineBinding;
  }

  private owned(actual: OfflineBinding): OfflineBinding {
    const registered = this.binding;
    if (!registered || !actual) throw new Error('offline adapter owner, account or generation mismatch');
    const checked = this.validate(actual);
    if (
      Object.keys(registered).some((field) =>
        registered[field as keyof OfflineBinding] !== checked[field as keyof OfflineBinding])) {
      throw new Error('offline adapter owner, account or generation mismatch');
    }
    return registered;
  }

  pair(input: OfflineBinding): void {
    if (this.binding || this.phase !== 'disconnected') throw new Error('fixture already bound');
    this.binding = this.validate(input);
    this.phase = 'login-required';
  }

  /** Host-supplied MANUAL status observation, never a credential or login automation. */
  observe(input: OfflineObservation): void {
    const data = dataRecord(input, ['binding', 'signedIn']);
    if (typeof data.signedIn !== 'boolean') throw new Error('invalid manual observation');
    this.owned(data.binding as OfflineBinding);
    if (this.phase === 'streaming' || this.phase === 'uncertain')
      throw new Error('in-flight or uncertain turn requires reconciliation');
    this.phase = data.signedIn ? 'fixture-ready' : 'login-required';
  }

  start(binding: OfflineBinding, turnID: string): void {
    this.owned(binding);
    assertOpaqueID(turnID, 'turnID');
    if (this.phase !== 'fixture-ready') throw new Error('offline adapter not ready for fixture turn');
    if (this.spent.has(turnID) || this.spent.size >= 64)
      throw new Error('fixture turn already spent: reconcile before retry');
    this.spent.add(turnID); // Consume before any simulated effect.
    this.turn = { id: turnID, seq: 0, text: '' };
    this.phase = 'streaming';
  }

  progress(binding: OfflineBinding, event: { turnID: string; seq: number; text: string }): void {
    this.owned(binding);
    const data = dataRecord(event, ['turnID', 'seq', 'text']);
    if (this.phase !== 'streaming' || !this.turn || data.turnID !== this.turn.id)
      throw new Error('offline adapter turn not streaming or wrong identity');
    if (!Number.isSafeInteger(data.seq) || data.seq !== this.turn.seq + 1)
      throw new Error('offline adapter fragment out of order');
    if (typeof data.text !== 'string' || !data.text || data.text.length > 4096 ||
      this.turn.text.length + data.text.length > 16_000 || (data.seq as number) > 63)
      throw new Error('offline adapter fragment out of bounds');
    this.turn.seq = data.seq as number;
    this.turn.text += data.text;
  }

  finish(binding: OfflineBinding, turnID: string, finalText: string): string {
    this.owned(binding);
    if (this.phase !== 'streaming' || !this.turn || this.turn.id !== turnID || !this.turn.seq ||
      finalText !== this.turn.text) throw new Error('offline adapter terminal mismatch');
    this.phase = 'finished';
    return finalText; // Test-only text; never parsed as an effect or tool instruction.
  }

  interrupt(binding: OfflineBinding): void {
    this.owned(binding);
    if (this.phase !== 'streaming') throw new Error('no fixture turn to interrupt');
    this.phase = 'uncertain'; // Never claim that an already-issued effect was cancelled.
  }

  reconnect(previous: OfflineBinding, next: OfflineBinding): void {
    this.owned(previous);
    if (this.phase === 'streaming' || this.phase === 'uncertain')
      throw new Error('reconcile uncertain fixture effect before reconnect');
    const updated = this.validate(next);
    if (updated.sessionID !== previous.sessionID || updated.accountRef !== previous.accountRef ||
      updated.tabID !== previous.tabID || updated.generation <= previous.generation ||
      updated.connectionID === previous.connectionID)
      throw new Error('fixture reconnection owner or generation mismatch');
    this.binding = updated;
    this.phase = 'login-required';
  }

  /** No automatic retry even after an operator observed the final outcome. */
  reconcile(binding: OfflineBinding, evidence: { turnID: string; outcome: 'observed-applied' | 'observed-not-applied'; hash: string }): void {
    this.owned(binding);
    const data = dataRecord(evidence, ['turnID', 'outcome', 'hash']);
    if (this.phase !== 'uncertain' || !this.turn || this.turn.id !== data.turnID ||
      typeof data.hash !== 'string' || !/^[a-f0-9]{64}$/.test(data.hash) ||
      !['observed-applied', 'observed-not-applied'].includes(data.outcome as string)) {
      throw new Error('invalid operator reconciliation evidence');
    }
    this.phase = 'login-required'; // Explicit manual observation required again.
  }
}
