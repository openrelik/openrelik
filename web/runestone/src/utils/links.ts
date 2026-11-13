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

/**
 * What a link in a file points at, read the way a browser would read it: so
 * what the link menu shows is where opening it would actually go, whatever
 * its label claims.
 */

export type LinkTarget =
  | {
      openable: true
      /** The URL as the browser normalises it: tabs and newlines gone, the host in ASCII. */
      href: string
      /** The host, in ASCII: a look-alike name shows as `xn--…`. */
      host: string
    }
  | { openable: false; reason: string }

/**
 * Whether a link can be opened, and where it goes. Only web links (`http`,
 * `https`) open. A relative link, or anything else that is no full
 * address, has nothing to resolve against but this app, and stays put.
 */
export function linkTarget(url: string): LinkTarget {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { openable: false, reason: 'Not a web address: nothing to open' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { openable: false, reason: `Only web links open, not ${parsed.protocol}` }
  }
  return { openable: true, href: parsed.href, host: parsed.host }
}
