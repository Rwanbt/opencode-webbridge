import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { detectDesktopCapabilities, browserApiAvailable, desktopE2EProven, diagnostic } from '../src/core/desktop-capability.js';

test('2.0.29 has no public browser API', () => {
  const caps = detectDesktopCapabilities({
    opencodeVersion: '2.0.29', hasRpc: true, hasPermission: true, hasBrowser: false,
    hasModelRegistration: true, desktopE2EAvailable: false,
  });
  assert.equal(caps.pluginBrowser, false);
  assert.equal(browserApiAvailable(caps), false);
  assert.equal(desktopE2EProven(caps), false);
});

test('diagnostic mentions absence', () => {
  const caps = detectDesktopCapabilities({
    opencodeVersion: '2.0.29', hasRpc: true, hasPermission: true, hasBrowser: false,
    hasModelRegistration: true, desktopE2EAvailable: false,
  });
  assert.ok(diagnostic(caps).includes('plugin.browser: false'));
});

test('desktop E2E proven only when flag true', () => {
  const caps = detectDesktopCapabilities({
    opencodeVersion: '2.0.32', hasRpc: true, hasPermission: true, hasBrowser: true,
    hasModelRegistration: true, desktopE2EAvailable: true,
  });
  assert.equal(desktopE2EProven(caps), true);
  assert.equal(browserApiAvailable(caps), true);
});
