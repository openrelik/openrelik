import { dataTypeOf } from '@/data/files'
import type { Item } from '@/data/folders'

export interface WorkerOption {
  key: string
  label: string
  default: string
  /** Must be filled in before the worker can run. */
  required?: boolean
}

export interface Worker {
  /** Queue suffix: `openrelik-worker-<id>`. */
  id: string
  name: string
  /** OpenRelik data types it is built for; `*` takes anything. */
  accepts: string[]
  /** Typical run time in seconds, from past runs. */
  typical: number
  options: WorkerOption[]
}

/** A mock catalogue of installed workers. */
export const WORKERS: Worker[] = [
  {
    id: 'regripper',
    name: 'RegRipper: all plugins',
    accepts: ['windows:registry'],
    typical: 20,
    options: [],
  },
  {
    id: 'regripper-profile',
    name: 'RegRipper: user hive profile',
    accepts: ['windows:registry'],
    typical: 10,
    options: [{ key: 'profile', label: 'profile', default: 'ntuser' }],
  },
  {
    id: 'plaso',
    name: 'Plaso: log2timeline',
    accepts: ['image:ewf', 'windows:registry', 'ntfs:mft'],
    typical: 812,
    options: [{ key: 'parsers', label: 'parsers', default: 'win7,webhist' }],
  },
  { id: 'psort', name: 'Plaso: psort', accepts: ['plaso:storage'], typical: 240, options: [] },
  {
    id: 'timesketch',
    name: 'Timesketch: upload',
    accepts: ['plaso:storage'],
    typical: 95,
    options: [{ key: 'sketch', label: 'sketch name', default: '', required: true }],
  },
  {
    id: 'extraction',
    name: 'Extraction: artifacts',
    accepts: ['image:ewf'],
    typical: 130,
    options: [],
  },
  {
    id: 'bulkextractor',
    name: 'Bulk extractor',
    accepts: ['image:ewf', 'memory:raw'],
    typical: 402,
    options: [],
  },
  {
    id: 'volatility',
    name: 'Volatility: windows.pslist',
    accepts: ['memory:raw'],
    typical: 180,
    options: [],
  },
  { id: 'mft', name: 'MFT parser: analyzeMFT', accepts: ['ntfs:mft'], typical: 60, options: [] },
  {
    id: 'exif',
    name: 'Exif: metadata',
    accepts: ['image:png', 'image:jpeg'],
    typical: 2,
    options: [],
  },
  { id: 'strings', name: 'Strings', accepts: ['*'], typical: 298, options: [] },
  {
    id: 'grep',
    name: 'Grep: keywords',
    accepts: ['*'],
    typical: 130,
    options: [{ key: 'keywords', label: 'keywords', default: '', required: true }],
  },
  {
    id: 'yara',
    name: 'Yara: rule scan',
    accepts: ['*'],
    typical: 77,
    options: [{ key: 'ruleset', label: 'ruleset', default: 'signature-base' }],
  },
  { id: 'hash', name: 'Hashing: sha256', accepts: ['*'], typical: 4, options: [] },
]

/** The type a worker is matched on: the file's data type, or its image kind. */
const typeOf = (file: Item) =>
  file.mime?.startsWith('image/') ? file.mime.replace('/', ':') : dataTypeOf(file)

export interface WorkerChoices {
  /** Built for every chosen file's type, most specific first. */
  suggested: Worker[]
  others: Worker[]
  /** The types involved, for the divider label. */
  types: string[]
}

/**
 * Split the catalogue for a set of files. A worker is suggested when it takes
 * every file's type — specific workers before the ones that take anything.
 * The rest are still offered: an examiner can know better than type detection.
 */
export function choicesFor(files: Item[]): WorkerChoices {
  const types = [...new Set(files.map(typeOf))]
  const fits = (worker: Worker) =>
    worker.accepts.includes('*') || types.every((type) => worker.accepts.includes(type))
  const specific = (worker: Worker) => (worker.accepts.includes('*') ? 1 : 0)
  const suggested = WORKERS.filter(fits).sort((a, b) => specific(a) - specific(b))
  return { suggested, others: WORKERS.filter((worker) => !fits(worker)), types }
}
