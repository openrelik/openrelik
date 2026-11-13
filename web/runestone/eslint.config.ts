import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from 'eslint-config-prettier/flat'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    rules: {
      'vue/multi-word-component-names': ['error', { ignores: ['Button', 'Switch', 'Tooltip', 'Prompt'] }],
      // Content from files and workers never becomes markup: see utils/markdown.ts.
      'vue/no-v-html': 'error',
    },
  },

  skipFormatting,
)
