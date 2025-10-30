import domenicConfig from "@domenic/eslint-config";
import globals from "globals";

export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node
    }
  },
  ...domenicConfig,
  {
    rules: {
      "no-console": "off",
      "max-len": ["error", { code: 120, ignoreRegExpLiterals: true, ignoreTemplateLiterals: true, ignoreUrls: true }]
    }
  }
];
