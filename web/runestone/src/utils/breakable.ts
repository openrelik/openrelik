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
 * `text` cut after every path or name separator (`/ \ . _ -`), so a renderer
 * can put a `<wbr>` between the parts: a long path or file name then wraps at
 * its separators instead of mid-word, or not at all. Joining the parts gives
 * `text` back.
 */
export function breakOpportunities(text: string): string[] {
  return text.split(/(?<=[/\\._-])(?=.)/)
}
