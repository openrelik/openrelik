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
 * A random version 4 UUID as 32 hex digits, the form OpenRelik uses for upload
 * and task ids. `crypto.randomUUID` only exists in secure contexts, and
 * operators reach some servers over plain HTTP on a VPN, so this is built from
 * `crypto.getRandomValues`, which works everywhere.
 */
export function hexId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // RFC 4122 variant
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
