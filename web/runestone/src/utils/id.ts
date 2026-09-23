import { v4 } from 'uuid'

/**
 * A random UUID as 32 hex digits, the form OpenRelik uses for upload and task
 * ids. `crypto.randomUUID` only exists in secure contexts, and operators reach
 * some servers over plain HTTP on a VPN, so this does not depend on it.
 */
export function hexId(): string {
  return v4().replaceAll('-', '')
}
