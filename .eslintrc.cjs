/** @type {import('@types/eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ["@remix-run/eslint-config", "prettier"],
  rules: {
    // Allow unused variables when prefixed with underscore
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
  ignorePatterns: ["node_modules/", "build/", "dist/", ".cache/"],
};
