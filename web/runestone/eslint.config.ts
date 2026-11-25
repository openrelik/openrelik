/*
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from 'eslint-config-prettier/flat'

const RESTRICTED_DESIGN_CLASSES = [
  '/^backdrop-blur/',
  '/^bg-gradient-/',
  '/^bg-ink\\/[1-9]\\d+/',
  '/^(?:placeholder:)?text-ink-muted\\//',
  '/^font-(bold|extrabold|black)$/',
  '/^shadow-(2xs|xs|sm|md|lg|xl|2xl)$/',
  '/^rounded-(xs|sm|md|lg|xl|2xl|3xl)$/',
  '/^(bg|text|border)-\\[#/',
]

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    name: 'app/style-and-design-rules',
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*'],
              message: 'Use @/ imports instead of parent-relative ../ paths.',
            },
          ],
          paths: [
            {
              name: 'lucide-vue-next',
              message: 'Import icons through @/components/icons instead.',
            },
            {
              name: '@/components/base/KeyHint.vue',
              message: 'KeyHint is reserved for HelpDialog.vue (§11).',
            },
          ],
        },
      ],
      'vue/multi-word-component-names': [
        'error',
        { ignores: ['Button', 'Switch', 'Tooltip', 'Prompt'] },
      ],
      // Content from files and workers never becomes markup: see utils/markdown.ts.
      'vue/no-v-html': 'error',
      'vue/no-restricted-static-attribute': [
        'error',
        {
          key: 'style',
          message:
            'Use Tailwind token classes instead of static style="..." (keep :style for computed geometry).',
        },
      ],
      'vue/no-restricted-class': ['error', ...RESTRICTED_DESIGN_CLASSES, '/^rounded-full$/'],
    },
  },

  // Allow lucide-vue-next inside the icons barrel only.
  {
    name: 'app/allow-lucide-barrel',
    files: ['src/components/icons/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['../*'], message: 'Use @/ imports instead of ../ paths.' }],
        },
      ],
    },
  },

  // Allow KeyHint inside HelpDialog and KeyHint's own unit test.
  {
    name: 'app/allow-keyhint',
    files: [
      'src/components/dialogs/HelpDialog.vue',
      'src/components/base/__tests__/KeyHint.test.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['../*'], message: 'Use @/ imports instead of ../ paths.' }],
          paths: [
            {
              name: 'lucide-vue-next',
              message: 'Import icons through @/components/icons instead.',
            },
          ],
        },
      ],
    },
  },

  // Allow rounded-full only in the four documented circular primitives/avatar discs (§4).
  {
    name: 'app/allow-rounded-full-primitives',
    files: [
      'src/components/base/Switch.vue',
      'src/components/base/UserAvatar.vue',
      'src/components/base/StatusDot.vue',
      'src/components/dialogs/ShareDialog.vue',
    ],
    rules: {
      'vue/no-restricted-class': ['error', ...RESTRICTED_DESIGN_CLASSES],
    },
  },

  // Dialogs must compose ModalSheet or PopoverSurface instead of hand-rolling <Teleport>.
  {
    name: 'app/dialogs-use-modal-primitive',
    files: ['src/components/dialogs/**/*.vue'],
    rules: {
      'vue/no-restricted-html-elements': [
        'error',
        {
          element: 'Teleport',
          message: 'Use ModalSheet or PopoverSurface instead of raw <Teleport> in dialogs.',
        },
      ],
    },
  },

  skipFormatting,
)
