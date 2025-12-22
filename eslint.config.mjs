import { dirname } from "path";
import { fileURLToPath } from "url";
import js from "@eslint/js";
import typescriptParser from "@typescript-eslint/parser";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";
import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  // Ignore patterns
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "contracts/**",
      "solana/**",
      "elizaos/**",
      "eliza/**",
      "privy-frames-v2-demo/**",
      "a2a-js/**",
      "*.config.js",
      "*.config.mjs",
      "*.config.ts",
    ],
  },

  // Base JS config
  js.configs.recommended,

  // TypeScript files configuration
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@typescript-eslint": typescriptPlugin,
      "@next/next": nextPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
      "import/resolver": {
        alias: {
          map: [["@", "./src"]],
          extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
        },
      },
    },
    rules: {
      // Disable rules that conflict with TypeScript
      "no-unused-vars": "off",
      "no-undef": "off",

      // TypeScript-specific rules
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",

      // Allow empty catch blocks (common pattern for optional error handling)
      "no-empty": ["error", { allowEmptyCatch: true }],

      // Next.js specific
      "@next/next/no-img-element": "off",

      // React hooks
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // JavaScript files configuration
  {
    files: ["src/**/*.js", "src/**/*.jsx"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      react: reactPlugin,
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
