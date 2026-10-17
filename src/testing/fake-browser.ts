import { WEB_PROVIDER_CATALOG } from '../catalog.js';
import { assertOpaqueID, assertTextOnlyTurn, type BrowserPort, type TabClaim, type TurnEvent, type TurnRequest } from '../core/browser-port.js';

type StoredTurn = { readonly prompt: string; readonly events: readonly TurnEvent[] };
type StoredTab = { readonly owner: TabClaim; readonly turns: Map<string, StoredTurn> };
const MAX_PROMPT = 16_000;

/** Offline-only fixture. No browser, HTTP requests, cookies or real service access. */
export class FakeBrowserPort implements BrowserPort {
  private readonly tabs = new Map<string, StoredTab>();
  private readonly sessions = new Map<string, string>();

  constructor(private readonly fixture: (text: string) => string = (text) => `fixture:${text}`) {}

  async claim(binding: TabClaim): Promise<void> {
    for (const [field, value] of Object.entries(binding)) assertOpaqueID(value, field);
    if (!WEB_PROVIDER_CATALOG.some((provider) => provider.id === binding.providerID)) {
      throw new Error('unsupported provider');
    }
    if (this.tabs.has(binding.tabID) || this.sessions.has(binding.sessionID)) {
      throw new Error('tab or session already claimed');
    }
    const owner = Object.freeze({ ...binding });
    this.tabs.set(binding.tabID, { owner, turns: new Map() });
    this.sessions.set(binding.sessionID, binding.tabID);
  }

  private owned(binding: TabClaim): StoredTab {
    const tab = this.tabs.get(binding.tabID);
    if (!tab || this.sessions.get(binding.sessionID) !== binding.tabID ||
      Object.entries(tab.owner).some(([key, value]) => binding[key as keyof TabClaim] !== value)) {
      throw new Error('tab binding not owned by this session, provider and account');
    }
    return tab;
  }

  async submit(binding: TabClaim, request: TurnRequest): Promise<void> {
    const tab = this.owned(binding);
    assertTextOnlyTurn(request);
    if (tab.turns.has(request.turnID)) throw new Error('turn already submitted: reconcile before retry');
    const answer = this.fixture(request.prompt);
    if (typeof answer !== 'string' || answer.length > MAX_PROMPT) throw new Error('fixture output out of bounds');
    const events: TurnEvent[] = [
      { seq: 1, kind: 'text', turnID: request.turnID, value: answer },
      { seq: 2, kind: 'finished', turnID: request.turnID },
    ];
    tab.turns.set(request.turnID, { prompt: request.prompt, events });
  }

  async events(binding: TabClaim, turnID: string, afterSeq: number): Promise<readonly TurnEvent[]> {
    const tab = this.owned(binding);
    assertOpaqueID(turnID, 'turnID');
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error('invalid sequence cursor');
    const turn = tab.turns.get(turnID);
    if (!turn) throw new Error('unknown turn');
    return turn.events.filter((event) => event.seq > afterSeq);
  }

  async cancel(binding: TabClaim, turnID: string): Promise<boolean> {
    const tab = this.owned(binding);
    assertOpaqueID(turnID, 'turnID');
    if (!tab.turns.has(turnID)) throw new Error('unknown turn');
    // Every fixture submit settles synchronously: truthful cancellation is false.
    return false;
  }

  async release(binding: TabClaim): Promise<void> {
    this.owned(binding);
    this.tabs.delete(binding.tabID);
    this.sessions.delete(binding.sessionID);
  }
}
