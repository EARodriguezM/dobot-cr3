import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated deployment bundles: thousands of vendored files that are not
    // ours to lint, and linting them fails the build on their style choices.
    ".open-next/**",
    ".wrangler/**",
    // Edge services are Python and ROS 2; the ROS build tree also emits
    // CMake dependency files with a .ts extension that are not TypeScript.
    "edge/**",
  ]),
]);

export default eslintConfig;
