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
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  Copy,
  CornerDownRight,
  CornerLeftUp,
  Download,
  Expand,
  Eye,
  EyeOff,
  File,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  KeyRound,
  ListTree,
  Lock,
  ListPlus,
  LogIn,
  LogOut,
  Maximize,
  Maximize2,
  Merge,
  Minimize,
  Minimize2,
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
  Shield,
  Shrink,
  Square,
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
