// Same rules the Obsidian Community directory scanner applies (eslint-plugin-obsidianmd).
// Ignores mirror the scanner's: tests, docs, build output and *.mjs tooling.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  globalIgnores(["main.js", "node_modules/", "tests/", "docs/", "*.mjs", "reference-*/"]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
    rules: {
      // Proper nouns, acronyms and literal identifiers the sentence-case rule would otherwise lowercase.
      "obsidianmd/ui/sentence-case": ["warn", {
        brands: ["Bitwarden", "BitLens", "Obsidian"],
        acronyms: ["API", "TOTP", "URL"],
        ignoreWords: ["client_id", "client_secret"],
        ignoreRegex: ["https?://", "user\\.x+", "→"],
      }],
    },
  },
]);
