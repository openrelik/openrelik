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
