// @vitest-environment happy-dom
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { useDropZone } from '@/composables/useDropZone'

interface MockDragOptions {
  hasFiles?: boolean
  files?: File[]
  entries?: (FileSystemEntry | null)[]
}

function makeDragEvent(
  type: string,
  options: MockDragOptions = {},
): {
  event: DragEvent
  preventDefault: ReturnType<typeof vi.fn>
  dataTransfer: {
    types: string[]
    dropEffect: DataTransfer['dropEffect']
    files: File[]
    items: { webkitGetAsEntry: () => FileSystemEntry | null }[]
  } | null
} {
  const preventDefault = vi.fn()
  const hasFiles = options.hasFiles ?? true
  const dataTransfer =
    options.hasFiles === false && !options.files && !options.entries
      ? {
          types: ['text/plain'],
          dropEffect: 'none' as DataTransfer['dropEffect'],
          files: [],
          items: [],
        }
      : {
          types: hasFiles ? ['Files'] : [],
          dropEffect: 'none' as DataTransfer['dropEffect'],
          files: options.files ?? [],
          items: (options.entries ?? []).map((entry) => ({
            webkitGetAsEntry: () => entry,
          })),
        }

  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'preventDefault', { value: preventDefault })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return { event, preventDefault, dataTransfer }
}

describe('useDropZone', () => {
  it('ignores drag events that do not carry files', () => {
    const onDrop = vi.fn()
    const { isOver, handlers } = useDropZone(onDrop)

    for (const type of ['dragenter', 'dragover', 'dragleave', 'drop'] as const) {
      const { event, preventDefault } = makeDragEvent(type, { hasFiles: false })
      handlers.value[type]?.(event)
      expect(preventDefault).not.toHaveBeenCalled()
    }

    expect(isOver.value).toBe(false)
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('tracks nested dragenter and dragleave depth without flickering', () => {
    const onDrop = vi.fn()
    const { isOver, handlers } = useDropZone(onDrop)

    const enterOuter = makeDragEvent('dragenter')
    handlers.value.dragenter?.(enterOuter.event)
    expect(enterOuter.preventDefault).toHaveBeenCalled()
    expect(isOver.value).toBe(true)

    const enterChild = makeDragEvent('dragenter')
    handlers.value.dragenter?.(enterChild.event)
    expect(isOver.value).toBe(true)

    handlers.value.dragleave?.(makeDragEvent('dragleave').event)
    expect(isOver.value).toBe(true)

    handlers.value.dragleave?.(makeDragEvent('dragleave').event)
    expect(isOver.value).toBe(false)

    // Extra dragleave clamps at 0
    handlers.value.dragleave?.(makeDragEvent('dragleave').event)
    expect(isOver.value).toBe(false)
  })

  it('sets dropEffect and gates isOver based on enabled()', () => {
    const allowed = ref(true)
    const onDrop = vi.fn()
    const { isOver, handlers } = useDropZone(onDrop, () => allowed.value)

    handlers.value.dragenter?.(makeDragEvent('dragenter').event)
    expect(isOver.value).toBe(true)

    const overAllowed = makeDragEvent('dragover')
    handlers.value.dragover?.(overAllowed.event)
    expect(overAllowed.preventDefault).toHaveBeenCalled()
    expect(overAllowed.dataTransfer?.dropEffect).toBe('copy')

    allowed.value = false
    expect(isOver.value).toBe(false)

    const overBlocked = makeDragEvent('dragover')
    handlers.value.dragover?.(overBlocked.event)
    expect(overBlocked.preventDefault).toHaveBeenCalled()
    expect(overBlocked.dataTransfer?.dropEffect).toBe('none')
  })

  it('extracts entries and files on drop, resets depth, and reports even when disabled', () => {
    const onDrop = vi.fn()
    const { isOver, handlers } = useDropZone(onDrop, () => false)

    handlers.value.dragenter?.(makeDragEvent('dragenter').event)
    const fakeEntry = { isFile: true, isDirectory: false, name: 'a.txt' } as FileSystemEntry
    const file = new File(['abc'], 'a.txt')
    const drop = makeDragEvent('drop', {
      files: [file],
      entries: [fakeEntry, null],
    })

    handlers.value.drop?.(drop.event)

    expect(drop.preventDefault).toHaveBeenCalled()
    expect(isOver.value).toBe(false)
    expect(onDrop).toHaveBeenCalledWith({
      entries: [fakeEntry],
      files: [file],
    })
  })
})
