/** Consent-gated production transport for the native web models.
 *
 * Consent model (explicit, individual, environment-declared): the operator
 * declares ONE already-open loopback CDP tab per provider
 * (`WEBBRIDGE_NATIVE_TAB_<PROVIDER>=http://127.0.0.1:<port>#<tabID>`) plus a
 * private journal directory (`WEBBRIDGE_NATIVE_JOURNAL_DIR`). Declaring the tab
 * IS the per-provider authorization; revocation is removing the declaration and
 * restarting (a tab that is closed, replaced or navigated away is refused at
 * read time). There is no per-send interactive approval in the language hook -
 * the public hook has no session identity; the upstream proposal asks for one.
 *
 * This module stays light: the CDP driver (playwright-backed G159/G157
 * primitives) is imported LAZILY on the first attach, so the dormant plugin
 * never pays for the browser stack. Everything here is refusal-first: malformed
 * declarations, non-loopback endpoints and non-private journals throw with an
 * actionable message instead of degrading.
 */
import { createFileAttemptStore, NATIVE_JOURNAL_DIR_OPT, requirePrivateDirectory } from "./attempt-store.js";
import { createBrowserTurnTransport } from "./browser-turn-transport.js";
import { WebBridgeSessionStateError, type NativeTurnTransport } from "./turn-transport.js";

/** Structural shape of a registered provider (registration.ts owns the catalog). */
export interface DeclaredTabTarget {
  readonly id: string;
  readonly providerID: string;
  readonly modelID: string;
  readonly label: string;
  readonly origin: string;
  readonly tabEnv: string;
}

export interface DeclaredTabConsent {
  /** Normalized loopback origin, e.g. `http://127.0.0.1:9222`. */
  readonly endpoint: string;
  readonly tabID: string;
  readonly journalDir: string;
}

/** Production observation budgets: ~32 s of bounded polling per turn. */
const PRODUCTION_POLLS = 64;
const PRODUCTION_INTERVAL_MS = 500;

export function nativeTabConsent(
  env: NodeJS.ProcessEnv,
  provider: DeclaredTabTarget,
): DeclaredTabConsent | null {
  const raw = (env[provider.tabEnv] ?? "").trim();
  if (!raw) return null;
  const parts = raw.split("#");
  if (parts.length !== 2 || !parts[0] || !parts[1])
    throw new Error(`WebBridge native models: ${provider.tabEnv} must be `
      + `"<http://127.0.0.1:port>#<tabID>" (the "#" part selects the exact CDP target)`);
  let url: URL;
  try { url = new URL(parts[0]); } catch {
    throw new Error(`WebBridge native models: ${provider.tabEnv} endpoint is not a valid URL`);
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !/^\d+$/.test(url.port) ||
      url.port === "0" || url.pathname !== "/" || url.search || url.hash ||
      url.username || url.password)
    throw new Error(`WebBridge native models: ${provider.tabEnv} must be an explicit loopback `
      + `debug endpoint (http://127.0.0.1:<port>#<tabID>)`);
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(parts[1]))
    throw new Error(`WebBridge native models: ${provider.tabEnv} tab id is not a CDP target id`);
  const journalDir = (env[NATIVE_JOURNAL_DIR_OPT] ?? "").trim();
  if (!journalDir)
    throw new Error(`WebBridge native models: ${NATIVE_JOURNAL_DIR_OPT} (private directory) `
      + `is required once ${provider.tabEnv} declares a browser session`);
  return Object.freeze({ endpoint: url.origin, tabID: parts[1], journalDir });
}

/** null = no declared tab for this provider: the model refuses explicitly. */
export async function consentedTransport(
  env: NodeJS.ProcessEnv,
  provider: DeclaredTabTarget,
): Promise<NativeTurnTransport | null> {
  const consent = nativeTabConsent(env, provider);
  if (!consent) return null;
  await requirePrivateDirectory(consent.journalDir); // loud configuration error at setup
  if (provider.id !== "chatgpt") {
    // The declaration itself is valid; the capability is not implemented yet. The
    // turn refuses with the precise state instead of taking the whole plugin down
    // (per-provider degradation, never a global veto or an invented answer).
    return createBrowserTurnTransport({
      providerID: provider.providerID,
      modelID: provider.modelID,
      store: createFileAttemptStore(consent.journalDir),
      polls: PRODUCTION_POLLS,
      intervalMs: PRODUCTION_INTERVAL_MS,
      attach: async () => {
        throw new WebBridgeSessionStateError(provider.label,
          '"' + provider.id + '" has no consented send primitive yet '
          + "(only chatgpt is implemented; never inventing one)");
      },
    });
  }
  return createBrowserTurnTransport({
    providerID: provider.providerID,
    modelID: provider.modelID,
    store: createFileAttemptStore(consent.journalDir),
    polls: PRODUCTION_POLLS,
    intervalMs: PRODUCTION_INTERVAL_MS,
    attach: async () => {
      const { attachDeclaredChatgptTab } = await import("./consented-cdp-attachment.js");
      return attachDeclaredChatgptTab({ provider, consent, env });
    },
  });
}
