module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "prettier"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  rules: {
    "linebreak-style": "off",
    "quotes": "off",
    "no-useless-escape": "warn",
    "no-console": "off",
    "no-var": "error",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-this-alias": "off",
    "no-async-promise-executor": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "no-useless-escape": "off"
  }
};
