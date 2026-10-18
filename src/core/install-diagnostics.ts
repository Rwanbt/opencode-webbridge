/**
 * Installation diagnostics for an installed WebBridge plugin directory.
 *
 * Pure and fail-closed: the manifest, version, integrity and configuration are
 * verified in a fixed order and any unproven fact refuses the installation.
 * No I/O, no OpenCode global config touched, no credentials read.
 */

import { validateConfig, defaultConfig, type WebBridgeConfig } from './config-validator.js';

export interface InstallDiagnosticsInput {
  readonly manifest: unknown;
  readonly expectedName: string;
  readonly expectedVersion: string;
  readonly configRaw?: unknown;
  readonly expectedSha256?: string;
  readonly observedSha256?: string;
}

export type DiagnosticsReport =
  | { readonly ok: true; readonly version: string; readonly config: WebBridgeConfig; readonly advisories: readonly string[] }
  | { readonly ok: false; readonly findings: readonly string[] };

const VERSION = /^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/i;

export function diagnoseInstall(input: InstallDiagnosticsInput): DiagnosticsReport {
  const fail = (...findings: string[]): DiagnosticsReport => ({ ok: false, findings });

  const m = input.manifest;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return fail('manifest-unreadable');
  const manifest = m as Record<string, unknown>;
  if (manifest.name !== input.expectedName) return fail('manifest-name-mismatch');
  if (typeof manifest.version !== 'string' || !VERSION.test(manifest.version)) return fail('manifest-version-invalid');
  if (!VERSION.test(input.expectedVersion)) return fail('expected-version-invalid');
  if (manifest.version !== input.expectedVersion) return fail('version-mismatch');

  // Integrity is verified only when expected; an expected hash can never be
  // silently skipped or satisfied by malformed input.
  if (input.expectedSha256 !== undefined) {
    if (!SHA256.test(input.expectedSha256) || input.observedSha256 === undefined || !SHA256.test(input.observedSha256)) {
      return fail('integrity-invalid');
    }
    if (input.expectedSha256.toLowerCase() !== input.observedSha256.toLowerCase()) {
      return fail('integrity-mismatch');
    }
  }

  const advisories: string[] = [];
  let config: WebBridgeConfig;
  if (input.configRaw === undefined) {
    advisories.push('config-absent');
    config = defaultConfig();
  } else {
    const result = validateConfig(input.configRaw);
    if (!result.ok) return fail(`config-invalid: ${result.reason}`);
    config = result.config;
  }
  if (!config.enabled) advisories.push('config-disabled');
  if (config.providers.length === 0) advisories.push('providers-empty');

  return { ok: true, version: manifest.version, config, advisories };
}
