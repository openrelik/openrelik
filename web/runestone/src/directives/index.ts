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
