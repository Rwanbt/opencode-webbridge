import { Plugin } from "@opencode/plugin";

/** Real distribution: inert by default. The single opt-in path below runs a
 * localhost SYNTHETIC TEST model/RPC, never a commercial web adapter. */
export default Plugin.define({
  id: "opencode.webbridge",
  async setup(ctx) {
    if (process.env.WEBBRIDGE_G150_LOCAL_FIXTURE !== "1") return;
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
