import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  // Electron main/preload run in Node (CommonJS), so require() is correct there.
  {
    files: ["electron.js", "preload.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "dist/**", // electron-builder output (packaged app)
    ".lan-site/**", // Wi-Fi share copy of the site (scripts/serve-lan.sh)
    ".web-site/**", // GitHub Pages copy of the site (scripts/deploy-web.sh)
    "resources/**", // bundled Redis binaries
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
