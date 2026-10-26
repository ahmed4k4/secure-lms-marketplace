import { FlatCompat } from "@eslint/eslintrc";
import { globalIgnores } from "eslint/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: path.dirname(fileURLToPath(import.meta.url)) });

// Next.js 15's `next/core-web-vitals` and `next/typescript` are legacy shareable
// configs; compat.config converts them for ESLint 9 flat config.
export default [
  ...compat.config({ extends: ["next/core-web-vitals", "next/typescript"] }),
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts"]),
];
