import { Plugin } from "@opencode/plugin";

/** Real root: dormant unless the user individually opts in.
 *  - native web models (opt-in list) are registered through public SDK hooks only;
 *  - read-only attached CDP sessions stay available under their own consent flag;
 *  - native model registration never fabricates an answer: without an attached
 *    authorized browser session the model refuses with an explicit state. */
export default Plugin.define({
  id: "opencode.webbridge",
  async setup(ctx) {
    const { registerNativeWebModels } = await import("./native/registration.js");
    const nativeCleanup = await registerNativeWebModels(ctx, process.env);
    if (process.env.WEBBRIDGE_G150_LOCAL_FIXTURE !== "1") {
      const cleanups: Array<() => Promise<void>> = [];
      if (process.env.WEBBRIDGE_PERSONAL_READONLY_TOOLS === "1") {
        const { registerReadonlyTools } = await import("./runtime/readonly-tools.js");
        const readonlyCleanup = await registerReadonlyTools(ctx, process.env);
        if (readonlyCleanup) cleanups.push(readonlyCleanup);
      }
      if (process.env.WEBBRIDGE_PERSONAL_CDP_READONLY === "1") {
        const { registerG163PersonalRead } = await import("./runtime/g163-root-read.js");
        const readCleanup = await registerG163PersonalRead(ctx, process.env);
        if (readCleanup) cleanups.push(readCleanup);
      }
      if (cleanups.length === 0) return nativeCleanup;
      return async () => {
        for (const cleanup of cleanups) await cleanup();
        if (nativeCleanup) await nativeCleanup();
      };
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
