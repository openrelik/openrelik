/**
 * OpenRelik API Type Contracts
 */

export interface User {
  id: number | string
  username: string
  display_name?: string
  email?: string
  avatar_url?: string
  profile_picture_url?: string | null
  is_admin?: boolean
  created_at?: string
}

/** A folder as listed (root folders, subfolders). The server does not include the parent. */
export interface Folder {
  id: number
  display_name: string
  name?: string
  description?: string
  parent_id?: number | null
  created_at?: string
  updated_at?: string
  user?: User
  /** The workflow that owns this folder; at most one. */
  workflows?: WorkflowRef[] | null
  selectable?: boolean
  file_count?: number
  folder_count?: number
  /** Top-level folders only: the case this folder is the folder of, normalized ("ir-2024/007"). */
  case_ref?: string | null
}

/** One page of the top-level folder list (GET /folders/all/), newest created first. */
export interface FolderPage {
  folders: Folder[]
  page: number
  page_size: number
  /** All folders in the list, across pages. */
  total_count: number
}

/** A file as listed inside a folder (GET /folders/{id}/files/). */
export interface FolderFile {
  id: number
  display_name: string
  filesize?: number
  /** OpenRelik's own classification, e.g. "file:generic". */
  data_type?: string
  magic_mime?: string | null
  user?: User
  created_at?: string
  updated_at?: string
  /** The listing does not filter these out; the client must. */
  is_deleted?: boolean
}

/** One file in full (GET /files/{id}): its hashes and what the server made of its content. */
export interface FileDetail extends FolderFile {
  /** Empty until the server has hashed it, in the background after an upload. */
  hash_md5?: string | null
  hash_sha1?: string | null
  hash_sha256?: string | null
  hash_ssdeep?: string | null
  /** libmagic's description, e.g. "PNG image data, 1024 x 768, 8-bit/color RGBA". */
  magic_text?: string | null
}

/**
 * The file the upload answers with once the last chunk lands. It is the raw
 * record: no `user`, and hashes are still empty (the server fills them in the
 * background).
 */
export interface UploadedFile extends FolderFile {
  filename?: string
  extension?: string
  magic_text?: string | null
  user_id?: number
  folder_id?: number
}

/** The operator's role on a folder, inherited from the nearest folder that sets one. */
export type FolderRole = 'Owner' | 'Editor' | 'Viewer' | 'No Access'

/** A single folder with its full ancestor chain, from GET /folders/{id}. */
export interface FolderDetail extends Folder {
  uuid: string
  description?: string
  parent: FolderDetail | null
  storage_provider?: string | null
  /** Who has access, set on this folder itself (inherited roles are not listed). */
  user_roles?: UserRoleRecord[]
  group_roles?: GroupRoleRecord[]
}

/** A user as the directory lists them (search results, role holders). */
export interface DirectoryUser {
  id: number
  display_name: string
  username: string
  profile_picture_url?: string | null
}

/** A group of users. */
export interface GroupRecord {
  id: number
  name: string
  description?: string | null
}

/** A user's role on a folder; `id` is the role's, for removing it. */
export interface UserRoleRecord {
  id: number
  role: FolderRole
  user: DirectoryUser
}

/** A group's role on a folder; `id` is the role's, for removing it. */
export interface GroupRoleRecord {
  id: number
  role: FolderRole
  group: GroupRecord
}

/** A workflow as folders list it. */
export interface WorkflowRef {
  id: number
  display_name?: string
}

/** One option a worker takes, as it registers it; `value` holds what the user chose. */
export interface TaskConfigOption {
  name: string
  label?: string
  description?: string
  /** `text`, `textarea`, `checkbox`, `select`, `autocomplete`, … */
  type?: string
  required?: boolean
  items?: string[]
  value?: unknown
}

/** A worker task the server can queue (GET /taskqueue/tasks/registered). */
export interface RegisteredTask {
  /** e.g. `openrelik-worker-strings.tasks.strings` */
  task_name: string
  queue_name: string
  display_name?: string
  description?: string
  task_config?: TaskConfigOption[]
}

/** One task in a workflow spec. Its `tasks` run on its output, in parallel. */
export interface SpecTask {
  type: 'task'
  /** 32 hex digits. The server replaces it on run and keys the task record on it. */
  uuid: string
  task_name: string
  queue_name: string
  display_name: string
  description?: string
  /** Must be a list: the server reads `{name: value}` pairs from it. */
  task_config: TaskConfigOption[]
  tasks: SpecNode[]
  /**
   * This UI's marker for which group a task belongs to among its siblings.
   * The server ignores it; tasks without one form a single group.
   */
  group?: string
}

/**
 * Parallel lines that a callback waits for: it runs once every line in
 * `tasks` has finished, on all their results.
 */
export interface SpecChord {
  type: 'chord'
  tasks: SpecTask[]
  callback: SpecTask
}

/** What a list of tasks in a spec may hold. */
export type SpecNode = SpecTask | SpecChord

/** What `spec_json` holds and what the run endpoint takes. The root's tasks run in parallel. */
export interface WorkflowSpec {
  workflow: { type: 'chain'; isRoot: true; tasks: SpecNode[] }
}

/** A task the server ran (or queued) for a workflow. */
export interface WorkflowTaskRecord {
  id: number
  uuid: string | null
  display_name: string | null
  /** Celery state: PENDING, RECEIVED, STARTED, PROGRESS, SUCCESS, FAILURE, REVOKED, … */
  status_short: string | null
  status_detail?: string | null
  /** What a running worker says it is doing, e.g. "40%" or a stage. */
  status_progress?: string | null
  /** Seconds. */
  runtime?: number | null
  error_exception?: string | null
  error_traceback?: string | null
  created_at?: string
  output_files?: { id: number; display_name: string; is_deleted?: boolean }[] | null
  /** The worker's findings for the whole task. */
  task_report?: ReportRecord | null
  /** The worker's findings per file, for files it flagged. */
  file_reports?: (ReportRecord & { file?: { id: number; display_name: string } | null })[] | null
}

/** A worker's report: priority 0–100, higher matters more (80 critical, 40 high, 20 medium, 10 low, 5 info). */
export interface ReportRecord {
  summary?: string
  priority?: number
  markdown?: string
}

/** A workflow with its spec and task records (every workflow endpoint answers with this). */
/** A saved workflow shape, to start new workflows from; task uuids are placeholders. */
export interface WorkflowTemplateRecord {
  id: number
  display_name: string
  description?: string | null
  spec_json: string
  user_id: number
  /** The creator; only the creator may delete a template. */
  user?: { id: number; display_name: string; username: string } | null
}

export interface WorkflowRecord {
  id: number
  display_name: string
  description?: string | null
  /** The spec as a JSON string; null until the first save. */
  spec_json: string | null
  uuid: string
  created_at?: string
  user?: User
  /** The input files. */
  files: { id: number; display_name: string; data_type?: string | null }[]
  tasks: WorkflowTaskRecord[]
  /** The folder the workflow owns; outputs land here. */
  folder: { id: number }
}
