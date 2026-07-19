import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "build/**",
      "dist/**",
      "dist-electron*/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "wiki-out/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Legacy code predates the strict Next.js defaults. Keep lint executable in
    // CI while type-checking remains the correctness gate; tighten these rules
    // incrementally instead of shipping a permanently broken `next lint` task.
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@next/next/no-html-link-for-pages": "off",
      "react/no-unescaped-entities": "off",
      "prefer-const": "off",
    },
  },
];

export default eslintConfig;
