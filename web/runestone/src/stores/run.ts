import { defineStore } from 'pinia'
import { ref } from 'vue'

import { ITEMS, type Item } from '@/data/folders'
import type { Worker } from '@/data/workers'
import { WORKFLOWS, type Task } from '@/data/workflows'

export interface RunTarget {
  files: Item[]
  folderId: number
}

export interface LastRunInfo {
  folderId: number
  label: string
  parentId: number
}

export const useRunStore = defineStore('run', () => {
  const runTarget = ref<RunTarget | null>(null)
  const lastRun = ref<LastRunInfo | null>(null)
  let clearTimer: ReturnType<typeof setTimeout> | undefined

  function open(files: Item[], folderId: number) {
    if (files.length) {
      runTarget.value = { files, folderId }
    }
  }

  function close() {
    runTarget.value = null
  }

  const nextId = () => Math.max(...ITEMS.map((item) => item.id)) + 1
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const stem = (name: string) => name.replace(/\.[^.]+$/, '')

  function start(worker: Worker, target: RunTarget, config: Record<string, string>): number {
    const { files, folderId } = target
    const label = files.length === 1 ? files[0]!.name : `${files.length} files`
    const name = `${worker.id} · ${label}`
    const id = nextId()
    const task: Task = {
      id: `run-${id}`,
      name: worker.name,
      module: `openrelik-worker-${worker.id}.tasks.${worker.id.replace(/-/g, '_')}`,
      queue: `openrelik-worker-${worker.id}`,
      status: 'running',
      started: now(),
      duration: 0,
      outputs: [],
      config,
      children: [],
    }

    const existing = WORKFLOWS.find((w) => w.folderId === folderId)
    if (existing) {
      existing.tasks.push(task)
      const seconds = 2 + Math.round(Math.random() * 4)
      const tick = setInterval(() => (task.duration = (task.duration ?? 0) + 1), 1000)

      setTimeout(() => {
        clearInterval(tick)
        if (!ITEMS.some((item) => item.id === folderId)) return
        const outputId = nextId()
        ITEMS.push({
          id: outputId,
          parent: folderId,
          kind: 'file',
          name: `${files.length === 1 ? stem(files[0]!.name) : 'combined'}.${worker.id}.txt`,
          owner: 'jbn',
          created: now(),
          modified: now(),
          size: 4_096 + Math.round(Math.random() * 200_000),
          mime: 'text/plain',
        })
        task.status = 'success'
        task.duration = seconds
        task.outputs = [outputId]
      }, seconds * 1000)

      lastRun.value = { folderId, label: `${worker.name} on ${label}`, parentId: folderId }
      clearTimeout(clearTimer)
      clearTimer = setTimeout(() => (lastRun.value = null), 10_000)
      return folderId
    }

    ITEMS.push({
      id,
      parent: folderId,
      kind: 'folder',
      name,
      owner: 'jbn',
      created: now(),
      modified: now(),
    })

    WORKFLOWS.push({
      id: 1000 + id,
      folderId: id,
      name,
      created: now(),
      inputs: files.map((file) => file.id),
      tasks: [task],
    })

    const live = WORKFLOWS.at(-1)!.tasks[0]!
    const seconds = 2 + Math.round(Math.random() * 4)
    const tick = setInterval(() => (live.duration = (live.duration ?? 0) + 1), 1000)

    setTimeout(() => {
      clearInterval(tick)
      if (!ITEMS.some((item) => item.id === id)) return // undone meanwhile
      const outputId = nextId()
      ITEMS.push({
        id: outputId,
        parent: id,
        kind: 'file',
        name: `${files.length === 1 ? stem(files[0]!.name) : 'combined'}.${worker.id}.txt`,
        owner: 'jbn',
        created: now(),
        modified: now(),
        size: 4_096 + Math.round(Math.random() * 200_000),
        mime: 'text/plain',
      })
      live.status = 'success'
      live.duration = seconds
      live.outputs = [outputId]
    }, seconds * 1000)

    lastRun.value = { folderId: id, label: `${worker.name} on ${label}`, parentId: folderId }
    clearTimeout(clearTimer)
    clearTimer = setTimeout(() => (lastRun.value = null), 10_000)
    return id
  }

  function undo(folderId: number) {
    for (let i = ITEMS.length - 1; i >= 0; i--) {
      const item = ITEMS[i]!
      if (item.id === folderId || item.parent === folderId) {
        ITEMS.splice(i, 1)
      }
    }
    const at = WORKFLOWS.findIndex((workflow) => workflow.folderId === folderId)
    if (at >= 0) {
      WORKFLOWS.splice(at, 1)
    }
    lastRun.value = null
  }

  return {
    runTarget,
    lastRun,
    open,
    close,
    start,
    undo,
  }
})
