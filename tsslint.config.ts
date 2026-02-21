import { createDiagnosticsPlugin, defineConfig } from "@tsslint/config";

const noopRule = () => {
  /* intentionally keeps the linter active */
};

export default defineConfig({
  plugins: [createDiagnosticsPlugin(["syntactic", "semantic"])],
  rules: {
    "tsc-diagnostics/noop": noopRule,
  },
});
