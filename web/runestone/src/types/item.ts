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

/** A folder or a file, as the app keeps it (`stores/items.ts`). */
export interface Item {
  /** Unique among items of one `kind` only; `itemKey` tells any two items apart. */
  id: number
  /** The containing folder, or null for a top-level folder. */
  parent: number | null
  kind: 'folder' | 'file'
  name: string
  /** The owner's display name, as the inspector and the tooltip show it. */
  owner: string
  /** The login the server knows the owner by. */
  ownerUsername?: string
  /** The owner's profile picture, when the server has one for them. */
  ownerAvatar?: string
  created?: string
  modified: string
  /** Bytes. Files only. */
  size?: number
  mime?: string
  /** OpenRelik's own classification of a file, e.g. "file:generic". */
  dataType?: string
  /** Folders only: the workflow that owns this folder. */
  workflowId?: number
  /** Top-level folders only: the case this is the folder of, as the server normalized it. */
  caseRef?: string
  /** Files only, once their details are loaded; empty strings until the server has hashed it. */
  hashes?: Hashes
  /** Files only, once their details are loaded: libmagic's description of the content. */
  magicText?: string
}

export interface Hashes {
  md5: string
  sha1: string
  sha256: string
}
