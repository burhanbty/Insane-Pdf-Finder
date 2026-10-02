import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  // Üretilen ve dışarıdan gelen dosyalar
  {
    ignores: ["node_modules/**", "dist/**", "downloads/**", ".cache/**", "public/*.min.js"],
  },

  // Tabi olmayan dosyalar (tarayıcı betikleri TypeScript değil)
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Kaynak dosyaları Türkçe karakterli değişken içerebilir; kod
      // ASCII'de kalsın diye zorlamıyoruz ama gereksiz boşluk/ virgül
      // hatalarını yakalıyoruz.
      "no-console": "off",
      eqeqeq: ["warn", "smart"],
      "prefer-const": "error",
      "no-var": "error",
    },
  },

  // Arayüz betiği: tarayıcı ortamı
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // Testler
  {
    files: ["test/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Prettier ile çakışan kuralları kapat (en sonda gelmeli)
  prettier,
);
