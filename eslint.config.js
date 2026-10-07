const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*'],
  },
  {
    rules: {
      // Modal/sheet sync + controlled TextInput — setState-in-effect is intentional here
      'react-hooks/set-state-in-effect': 'off',
      '@typescript-eslint/array-type': 'off',
    },
  },
]);
