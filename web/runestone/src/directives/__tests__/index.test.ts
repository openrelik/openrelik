// @vitest-environment happy-dom
import { createApp, defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'

import defaultDirectives, {
  directives,
  vAutofocus,
  vClickOutside,
  vCopyToClipboard,
  vOverflowTooltip,
  vScrollIntoView,
  vTooltip,
  vTrapFocus,
} from '@/directives'

describe('directives plugin', () => {
  it('registers all application directives and re-exports each directive', () => {
    expect(defaultDirectives).toBe(directives)

    const app = createApp(defineComponent({ template: '<div />' }))
    app.use(directives)

    expect(app.directive('tooltip')).toBe(vTooltip)
    expect(app.directive('copy-to-clipboard')).toBe(vCopyToClipboard)
    expect(app.directive('copy')).toBe(vCopyToClipboard)
    expect(app.directive('click-outside')).toBe(vClickOutside)
    expect(app.directive('autofocus')).toBe(vAutofocus)
    expect(app.directive('scroll-into-view')).toBe(vScrollIntoView)
    expect(app.directive('trap-focus')).toBe(vTrapFocus)
    expect(app.directive('overflow-tooltip')).toBe(vOverflowTooltip)
  })
})
