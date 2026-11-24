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

/** Session storage key used to preserve `?redirect=` across external OAuth/OIDC redirects. */
export const POST_LOGIN_REDIRECT_KEY = 'openrelik.auth.redirect'

/** Accepts only same-origin non-login app paths so a tampered redirect cannot bounce off-site. */
export function safeRedirectTarget(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.startsWith('/\\')
  ) {
    return '/'
  }
  try {
    const url = new URL(raw, 'http://localhost')
    if (url.origin !== 'http://localhost' || /^\/login\/?$/i.test(url.pathname)) {
      return '/'
    }
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}
