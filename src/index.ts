import { Plugin } from "@opencode/plugin";

/**
 * Bootstrap only. Do not register catalog models before a real, verified
 * browser transport and permitted service integration exist.
 */
export default Plugin.define({
  id: "opencode.webbridge",
  setup() {
    // Deliberately inert until the transport and permission gates are built.
  },
});
