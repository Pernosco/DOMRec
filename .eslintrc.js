module.exports = {
  env: {
    es6: true,
    browser: true
  },
  globals: {},
  extends: [
    'prettier',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript'
  ],
  ignorePatterns: ['**/node_modules/**'],
  parserOptions: {
    ecmaVersion: 8,
    sourceType: 'module'
  },
  plugins: ['import', 'jsdoc'],
  rules: {
    'arrow-parens': ['error', 'as-needed'],
    'linebreak-style': ['error', 'unix'],
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'always'],
    'array-bracket-spacing': [
      'error',
      'never',
      {
        objectsInArrays: false,
        arraysInArrays: false
      }
    ],
    'switch-colon-spacing': 'error',
    'constructor-super': 'error',
    'for-direction': 'error',
    'getter-return': 'error',
    'no-async-promise-executor': 'error',
    'no-case-declarations': 'error',
    'no-class-assign': 'error',
    'no-compare-neg-zero': 'error',
    'no-cond-assign': 'error',
    'no-const-assign': 'error',
    'no-constant-condition': 'error',
    'no-control-regex': 'error',
    'no-debugger': 'error',
    'no-delete-var': 'error',
    'no-dupe-args': 'error',
    'no-dupe-class-members': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-empty': 'off',
    'no-empty-character-class': 'error',
    'no-ex-assign': 'error',
    'no-extra-boolean-cast': 'error',
    'no-extra-semi': 'error',
    'no-fallthrough': 'error',
    'no-func-assign': 'error',
    'no-global-assign': 'error',
    'no-inner-declarations': 'error',
    'no-invalid-regexp': 'error',
    'no-irregular-whitespace': 'error',
    'no-misleading-character-class': 'error',
    'no-mixed-spaces-and-tabs': 'error',
    'no-new-symbol': 'error',
    'no-obj-calls': 'error',
    'no-octal': 'error',
    'no-prototype-builtins': 'error',
    'no-redeclare': 'error',
    'no-regex-spaces': 'error',
    'no-restricted-globals': ['error', 'fit', 'fdescribe'],
    'no-return-await': 'error',
    'no-self-assign': 'error',
    'no-shadow-restricted-names': 'error',
    'no-sparse-arrays': 'error',
    'no-this-before-super': 'error',
    'no-undef': 'error',
    'no-unexpected-multiline': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-unsafe-negation': 'error',
    'no-unused-labels': 'error',
    'no-unused-vars': 'off',
    'no-useless-catch': 'error',
    'no-useless-escape': 'error',
    'no-with': 'error',
    'object-curly-spacing': ['error', 'always'],
    'prefer-arrow-callback': 'error',
    'prefer-template': 'error',
    'require-await': 'error',
    'require-atomic-updates': 'error',
    'require-yield': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
    'arrow-body-style': 'error',
    'comma-dangle': 'error',
    curly: 'error',
    'dot-notation': 'off',
    'eol-last': 'error',
    eqeqeq: ['error', 'smart'],
    'guard-for-in': 'error',
    'id-blacklist': 'off',
    'id-match': 'off',
    'import/no-deprecated': 'warn',
    'import/no-duplicates': 'error',
    'import/order': [
      'error',
      {
        'newlines-between': 'always',
        alphabetize: {
          order: 'asc'
        }
      }
    ],
    'jsdoc/no-types': 0,
    'max-len': [
      'error',
      {
        code: 140,
        ignoreStrings: true,
        ignoreTemplateLiterals: true
      }
    ],
    'no-bitwise': 'error',
    'no-caller': 'error',
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'no-eval': 'error',
    'no-new-wrappers': 'error',
    'no-restricted-imports': ['error', 'rxjs/Rx'],
    'no-shadow': [
      'error',
      {
        hoist: 'all'
      }
    ],
    'no-throw-literal': 'error',
    'no-trailing-spaces': 'error',
    'no-undef-init': 'error',
    'no-unused-expressions': 'error',
    'no-var': 'error',

    'object-shorthand': 'error',
    'prefer-const': 'error',
    'quote-props': ['error', 'as-needed'],
    radix: 'error',
    'space-before-function-paren': [
      'error',
      {
        anonymous: 'always',
        named: 'never',
        asyncArrow: 'always'
      }
    ],
    'space-in-parens': 'error',
    'spaced-comment': 'error',
    'template-curly-spacing': ['error', 'never']
  },
  settings: {
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts']
    },
    'import/resolver': {
      typescript: {
        project: './',
        alwaysTryTypes: true
      }
    },
    'import/ignore': ['lodash']
  },
  overrides: [
    {
      files: ['*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: 'tsconfig.json'
      },
      plugins: ['@typescript-eslint', '@typescript-eslint/tslint'],
      rules: {
        '@typescript-eslint/naming-convention': [
          'error',
          {
            selector: 'variable',
            format: ['camelCase', 'UPPER_CASE', 'PascalCase']
          }
        ],
        '@typescript-eslint/consistent-type-definitions': 'error',
        '@typescript-eslint/explicit-function-return-type': ['error'],
        '@typescript-eslint/explicit-member-accessibility': [
          'error',
          {
            accessibility: 'explicit',
            overrides: {
              constructors: 'no-public'
            }
          }
        ],
        '@typescript-eslint/member-delimiter-style': [
          'error',
          {
            multiline: {
              delimiter: 'semi',
              requireLast: true
            },
            singleline: {
              delimiter: 'semi',
              requireLast: false
            }
          }
        ],
        '@typescript-eslint/member-ordering': 'error',
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-empty-interface': 'error',
        '@typescript-eslint/no-inferrable-types': 'error',
        '@typescript-eslint/no-misused-new': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/no-unused-vars': 'error',
        '@typescript-eslint/no-use-before-define': 'error',
        '@typescript-eslint/prefer-function-type': 'error',
        '@typescript-eslint/semi': ['error', 'always'],
        '@typescript-eslint/type-annotation-spacing': 'error',
        '@typescript-eslint/unified-signatures': 'error',
        '@typescript-eslint/tslint/config': [
          'error',
          {
            rulesDirectory: ['codelyzer'],
            rules: {
              'component-class-suffix': [true, 'Component', 'Page'],
              'directive-class-suffix': true,
              'import-spacing': true,
              'no-host-metadata-property': true,
              'no-input-rename': true,
              'no-inputs-metadata-property': true,
              'no-output-on-prefix': true,
              'no-output-rename': true,
              'no-outputs-metadata-property': true,
              'one-line': [
                true,
                'check-open-brace',
                'check-catch',
                'check-else',
                'check-whitespace'
              ],
              'use-lifecycle-interface': true,
              'use-pipe-transform-interface': true,
              whitespace: [
                true,
                'check-branch',
                'check-decl',
                'check-operator',
                'check-separator',
                'check-type'
              ]
            }
          }
        ]
      }
    }
  ]
};
