import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { assertCdpDocumentEpoch, type CdpDocumentEpoch } from '../src/browser/cdp-document-epoch.js';

const original: CdpDocumentEpoch = {
  frameID: 'sameTargetFrame', loaderID: 'document1', url: 'https://chatgpt.com/c/selected',
};
test('G161 frame+loader epoch rejects SAME URL reload and new document after await', () => {
  assert.doesNotThrow(() => assertCdpDocumentEpoch({ ...original }, original));
  assert.throws(() => assertCdpDocumentEpoch({ ...original, loaderID: 'document2' }, original),
    /document replaced/);
  assert.throws(() => assertCdpDocumentEpoch({ ...original, frameID: 'newFrame' }, original),
    /document replaced/);
  assert.throws(() => assertCdpDocumentEpoch({ ...original, url: 'https://chatgpt.com/c/other' }, original),
    /document replaced/);
});
