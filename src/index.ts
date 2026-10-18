import { Plugin } from "@opencode/plugin";

/** Real root: dormant unless user opts into read-only attached CDP sessions.
 * Native model registration is intentionally withheld until an authorized
 * send + terminal inference contract exists (not merely a browser DOM reader). */
export default Plugin.define({
  id: "opencode.webbridge",
  async setup(ctx) {
    if (process.env.WEBBRIDGE_G150_LOCAL_FIXTURE !== "1") {
      if (process.env.WEBBRIDGE_PERSONAL_CDP_READONLY !== "1") return;
      const { registerG163PersonalRead } = await import("./runtime/g163-root-read.js");
      return registerG163PersonalRead(ctx, process.env);
    }
    if (process.env.WEBBRIDGE_G81_TEST_ONLY !== "1" ||
        !/^[a-f0-9]{64}$/.test(process.env.WEBBRIDGE_G81_SECRET ?? "") ||
        !/^[a-f0-9]{64}$/.test(process.env.WEBBRIDGE_FIXTURE_TOKEN ?? "")) {
      throw new Error("G150 local-only fixture authorization missing");
    }
    let target: URL;
    try { target = new URL(process.env.WEBBRIDGE_FIXTURE_URL ?? ""); }
    catch { throw new Error("G150 malformed local model endpoint"); }
    if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" ||
        target.pathname !== "/v1" || !!target.username || !!target.password ||
        !!target.search || !!target.hash) {
      throw new Error("G150 external model endpoint forbidden");
    }
    const fixture = await import("./g97-local.mjs");
    return fixture.default.setup(ctx);
  },
});
