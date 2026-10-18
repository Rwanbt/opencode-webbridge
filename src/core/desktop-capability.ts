/**
 * OpenCode Desktop/Electron capability detection.
 *
 * Records which public extension points are actually present in a given
 * OpenCode version. Absence is a real, documented limitation — never faked.
 */

export interface DesktopCapabilities {
  readonly opencodeVersion: string;
  readonly pluginRpc: boolean;
  readonly pluginPermission: boolean;
  readonly pluginBrowser: boolean; // always false in 2.0.29
  readonly modelRegistration: boolean;
  readonly desktopE2EAvailable: boolean;
}

export function detectDesktopCapabilities(input: {
  opencodeVersion: string;
  hasRpc: boolean;
  hasPermission: boolean;
  hasBrowser: boolean;
  hasModelRegistration: boolean;
  desktopE2EAvailable: boolean;
}): DesktopCapabilities {
  return Object.freeze({
    opencodeVersion: input.opencodeVersion,
    pluginRpc: !!input.hasRpc,
    pluginPermission: !!input.hasPermission,
    pluginBrowser: !!input.hasBrowser,
    modelRegistration: !!input.hasModelRegistration,
    desktopE2EAvailable: !!input.desktopE2EAvailable,
  });
}

export function browserApiAvailable(caps: DesktopCapabilities): boolean {
  return caps.pluginBrowser === true;
}

export function desktopE2EProven(caps: DesktopCapabilities): boolean {
  return caps.desktopE2EAvailable === true;
}

export function diagnostic(caps: DesktopCapabilities): string {
  const lines = [
    `OpenCode ${caps.opencodeVersion}`,
    `plugin.rpc: ${caps.pluginRpc}`,
    `plugin.permission: ${caps.pluginPermission}`,
    `plugin.browser: ${caps.pluginBrowser} (public browser API absent in 2.0.29)`,
    `model registration: ${caps.modelRegistration}`,
    `Desktop E2E proven: ${caps.desktopE2EAvailable}`,
  ];
  return lines.join('\n');
}
