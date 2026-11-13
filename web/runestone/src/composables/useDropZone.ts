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
 * Drop Zone Composable
 *
 * Files dropped on an element, without the usual drag-and-drop traps:
 *
 * - `dragenter`/`dragleave` fire for every child element, so the highlight is
 *   counted in and out rather than toggled, and never flickers over rows.
 * - Only drags that actually carry files count; a text selection dragged
 *   across the listing is ignored.
 * - Dropped folders arrive as entries, which the caller walks: the tree is
 *   recreated on the server rather than refused.
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

export interface DroppedFiles {
  /** Everything dropped, files and folders alike. Folders are walked by the caller. */
  entries: FileSystemEntry[]
  /** The plain files, for browsers that do not hand out entries. */
  files: File[]
}

export interface UseDropZoneReturn {
  /** A file drag is over the element (and dropping is allowed). */
  isOver: Readonly<Ref<boolean>>
  /** Bind with `v-on`: dragenter, dragover, dragleave and drop. */
  handlers: ComputedRef<Record<string, (event: DragEvent) => void>>
}

const carriesFiles = (event: DragEvent): boolean => !!event.dataTransfer?.types?.includes('Files')

/**
 * `enabled`: whether this place accepts files (the root does not). A drop is
 * reported either way — refusing silently leaves the operator guessing.
 */
export function useDropZone(
  onDrop: (dropped: DroppedFiles) => void,
  enabled: () => boolean = () => true,
): UseDropZoneReturn {
  const depth = ref(0)
  const isOver = computed(() => depth.value > 0 && enabled())

  function onDragEnter(event: DragEvent) {
    if (!carriesFiles(event)) return
    event.preventDefault()
    depth.value++
  }

  function onDragOver(event: DragEvent) {
    if (!carriesFiles(event)) return
    // Without this the browser opens the file instead of letting it drop.
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = enabled() ? 'copy' : 'none'
  }

  function onDragLeave(event: DragEvent) {
    if (!carriesFiles(event)) return
    depth.value = Math.max(0, depth.value - 1)
  }

  function onDropped(event: DragEvent) {
    if (!carriesFiles(event)) return
    event.preventDefault()
    depth.value = 0
    // Reported even where dropping is not allowed, so the caller can say why.
    // Entries must be taken now: the drag data is gone once this returns.
    const entries = [...(event.dataTransfer?.items ?? [])]
      .map((item) => item.webkitGetAsEntry())
      .filter((entry): entry is FileSystemEntry => !!entry)
    onDrop({ entries, files: [...(event.dataTransfer?.files ?? [])] })
  }

  return {
    isOver,
    handlers: computed(() => ({
      dragenter: onDragEnter,
      dragover: onDragOver,
      dragleave: onDragLeave,
      drop: onDropped,
    })),
  }
}
