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

import type { App, Plugin } from 'vue'

import { vAutofocus } from './autofocus'
import { vClickOutside } from './clickOutside'
import { vCopyToClipboard } from './copyToClipboard'
import { vOverflowTooltip } from './overflowTooltip'
import { vScrollIntoView } from './scrollIntoView'
import { vTooltip } from './tooltip'
import { vTrapFocus } from './trapFocus'

export {
  vAutofocus,
  vClickOutside,
  vCopyToClipboard,
  vOverflowTooltip,
  vScrollIntoView,
  vTooltip,
  vTrapFocus,
}

/**
 * Vue plugin that registers all application directives globally.
 */
export const directives: Plugin = {
  install(app: App) {
    app.directive('tooltip', vTooltip)
    app.directive('copy-to-clipboard', vCopyToClipboard)
    app.directive('copy', vCopyToClipboard)
    app.directive('click-outside', vClickOutside)
    app.directive('autofocus', vAutofocus)
    app.directive('scroll-into-view', vScrollIntoView)
    app.directive('trap-focus', vTrapFocus)
    app.directive('overflow-tooltip', vOverflowTooltip)
  },
}

export default directives
