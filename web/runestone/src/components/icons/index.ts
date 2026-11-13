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
 * Icon Abstraction Layer (Adapter)
 *
 * RATIONALE & ARCHITECTURE:
 * This module acts as an abstraction boundary for all icons used across the application.
 * By routing all icon imports through this barrel rather than coupling components
 * directly to third-party vendor packages (like `lucide-vue-next`), the codebase achieves:
 *
 * 1. Vendor Insulation: If the upstream icon library changes its API, renames icons,
 *    or is deprecated/abandoned, only this single adapter file needs to be updated.
 * 2. Drop-in Replaceability: The rest of the codebase remains agnostic of the underlying
 *    icon provider. We can swap `lucide-vue-next` for `@tabler/icons-vue`, `@heroicons/vue`,
 *    `unplugin-icons`, or local native SVGs with zero changes across views and components.
 * 3. Tree-shakability: Re-exporting named components preserves Vite/Rollup's ability
 *    to tree-shake unused icons during production builds.
 */

export {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Ban,
  Briefcase,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  CircleCheck,
  Copy,
  CornerDownRight,
  CornerLeftUp,
  Download,
  Ellipsis,
  Expand,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileText,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  ImageOff,
  HardDrive,
  KeyRound,
  ListTree,
  Lock,
  ListPlus,
  LogOut,
  Maximize,
  Merge,
  Minimize,
  Minus,
  Monitor,
  Moon,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Settings2,
  Shrink,
  Sun,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  UserPlus,
  Users,
  Workflow,
  X,
} from 'lucide-vue-next'
