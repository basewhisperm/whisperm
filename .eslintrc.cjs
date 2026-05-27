module.exports = {
  root: true,
  ignorePatterns: ["**/dist/**", "**/build/**", "**/.next/**"],
  extends: [],
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      parserOptions: {
        project: true,
        tsconfigRootDir: __dirname
      },
      rules: {}
    }
  ]
};
