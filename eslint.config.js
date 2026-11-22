import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'target/**',
      'release/**',
      'node_modules/**',
      'src-tauri/**',
      'data/**',
      '.agents/**',
      'design/**',
      '.claude/**',
      '**/vendor/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {...globals.browser, ...globals.es2024},
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Только классические правила хуков. Новые правила под React Compiler
      // (refs, purity, set-state-in-effect) включатся, когда проект будет к этому готов.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Компоненты среза живут рядом с хуками и вспомогательными функциями — это норма проекта.
      'react-refresh/only-export-components': ['warn', {allowConstantExport: true}],
      // Пустой catch здесь осознанный: недоступный localStorage не должен ломать интерфейс.
      'no-empty': ['error', {allowEmptyCatch: true}],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true},
      ],
      // Внешние данные из API и media-объекты приходят неизвестными; границы проверяются вручную.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-useless-escape': 'error',
    },
  },
  {
    files: ['**/*.mjs', 'scripts/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: {...globals.node},
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}],
    },
  },
  {
    files: ['src/**/*.test.mjs'],
    languageOptions: {globals: {...globals.node}},
  },
  prettier,
);
