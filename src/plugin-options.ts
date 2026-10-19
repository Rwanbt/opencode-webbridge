/** Activation and personal settings coming from the PLUGIN CONFIGURATION.
 *
 *  Why this exists (observed 2026-10-19): activation used to come only from
 *  `process.env`, which the server reads when it starts. The OpenCode chat runs
 *  against a long-lived background server, so the plugin loaded but stayed
 *  dormant and WebBridge never appeared in the provider picker. The CLI hid this
 *  because `opencode run --standalone` starts a private server that inherits the
 *  shell environment.
 *
 *  The configuration file IS read at every server start, so it is the correct
 *  source for a setting that must survive a restart of the app. This module maps
 *  a small, explicit allowlist of options onto the exact environment variables
 *  the rest of the plugin already reads, so nothing downstream changes.
 *
 *  Everything here is untrusted configuration: only strings, booleans and a
 *  bounded string array are accepted; anything else is ignored rather than
 *  coerced. `process.env` still wins, so an explicit shell variable overrides
 *  the file (useful for a one-off `--standalone` run). */

const PROVIDER_ID = /^[a-z][a-z0-9]{1,31}$/;
const TAB_DECLARATION = /^http:\/\/127\.0\.0\.1:\d+#[A-Za-z0-9_-]{4,128}$/;
const MAX_PROVIDERS = 8;
const MAX_TABS = 8;
const MAX_PATH = 512;

const str = (value: unknown, max = MAX_PATH): string | null =>
  typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;

/** The environment variables implied by a plugin's `options` object. */
export function activationEnvFrom(options: unknown): Record<string, string> {
  const env: Record<string, string> = {};
  if (typeof options !== "object" || options === null || Array.isArray(options)) return env;
  const o = options as Record<string, unknown>;

  const providers = o.providers;
  if (Array.isArray(providers)) {
    const list = providers
      .filter((value): value is string => typeof value === "string" && PROVIDER_ID.test(value))
      .slice(0, MAX_PROVIDERS);
    if (list.length) env.WEBBRIDGE_NATIVE_WEB_MODELS = list.join(",");
  }

  const journalDir = str(o.journalDir);
  if (journalDir) env.WEBBRIDGE_NATIVE_JOURNAL_DIR = journalDir;

  const tabs = o.tabs;
  if (typeof tabs === "object" && tabs !== null && !Array.isArray(tabs)) {
    let declared = 0;
    for (const [id, value] of Object.entries(tabs as Record<string, unknown>)) {
      if (declared >= MAX_TABS) break;
      if (!PROVIDER_ID.test(id)) continue;
      const declaration = str(value, 256);
      if (!declaration || !TAB_DECLARATION.test(declaration)) continue;
      env["WEBBRIDGE_NATIVE_TAB_" + id.toUpperCase()] = declaration;
      declared += 1;
    }
  }

  if (o.fixture === true) env.WEBBRIDGE_NATIVE_MODEL_FIXTURE = "1";
  if (o.readonlyTools === true) env.WEBBRIDGE_PERSONAL_READONLY_TOOLS = "1";
  if (o.cdpReadonly === true) env.WEBBRIDGE_PERSONAL_CDP_READONLY = "1";
  const workspace = str(o.workspace);
  if (workspace) env.WEBBRIDGE_PERSONAL_WORKSPACE = workspace;

  return env;
}

/** Configuration first, then the real environment so a shell variable wins. */
export function effectiveEnv(
  options: unknown,
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return { ...activationEnvFrom(options), ...env };
}
