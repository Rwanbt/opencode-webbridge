import { Rpc } from '@opencode/plugin/rpc';

/** Test-only relay contract. Intentionally does NOT implement browser actions. */
const identity = {
  sessionID: { type: 'string' },
  tabID: { type: 'string' },
  providerID: { type: 'string' },
  accountRef: { type: 'string' },
  secret: { type: 'string' },
} as const;

export const BrowserRelayRPC = Rpc.define({
  id: 'webbridge-browser-fixture',
  methods: {
    submit: {
      input: { type: 'object', properties: { ...identity, turnID: { type: 'string' }, prompt: { type: 'string' } },
        required: [...Object.keys(identity), 'turnID', 'prompt'], additionalProperties: false },
      output: { type: 'object', properties: { accepted: { type: 'boolean' } }, required: ['accepted'], additionalProperties: false },
    },
    take: {
      input: { type: 'object', properties: identity, required: Object.keys(identity), additionalProperties: false },
      output: { type: 'object', properties: { found: { type: 'boolean' }, turnID: { type: 'string' }, prompt: { type: 'string' } },
        required: ['found'], additionalProperties: false },
    },
    complete: {
      input: { type: 'object', properties: { ...identity, turnID: { type: 'string' }, response: { type: 'string' } },
        required: [...Object.keys(identity), 'turnID', 'response'], additionalProperties: false },
      output: { type: 'object', properties: { accepted: { type: 'boolean' } }, required: ['accepted'], additionalProperties: false },
    },
    result: {
      input: { type: 'object', properties: { ...identity, turnID: { type: 'string' } },
        required: [...Object.keys(identity), 'turnID'], additionalProperties: false },
      output: { type: 'object', properties: { finished: { type: 'boolean' }, response: { type: 'string' } },
        required: ['finished'], additionalProperties: false },
    },
  },
  events: {},
});
