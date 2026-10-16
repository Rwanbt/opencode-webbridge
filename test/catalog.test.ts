import { test } from "node:test";
import { strict as assert } from "node:assert";
import { WEB_PROVIDER_CATALOG } from "../src/catalog.js";

test("all five planned providers are named uniquely", () => {
  assert.deepEqual(
    WEB_PROVIDER_CATALOG.map((provider) => provider.id),
    ["chatgpt", "deepseek", "gemini", "qwen", "mistral"],
  );
  assert.equal(new Set(WEB_PROVIDER_CATALOG.map((provider) => provider.id)).size, 5);
});

test("provider website origins use HTTPS and no embedded credentials", () => {
  for (const provider of WEB_PROVIDER_CATALOG) {
    const url = new URL(provider.origin);
    assert.equal(url.protocol, "https:");
    assert.equal(url.username, "");
    assert.equal(url.password, "");
    assert.equal(url.pathname, "/");
  }
});
