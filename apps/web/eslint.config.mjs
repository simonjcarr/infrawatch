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
    // Plain CommonJS Node.js scripts — not part of the TypeScript module graph
    "migrate.js",
    "scripts/validate-migrations.js",
  ]),
  {
    // Playwright fixtures use a `use()` callback that the react-hooks plugin
    // mistakes for React's `use()` hook. Disable that rule inside the e2e
    // suite — no React code lives here.
    files: ["tests/e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);

export default eslintConfig;
