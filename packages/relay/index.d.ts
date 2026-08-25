export interface LocalRelay {
  /** ws:// URL of the locally-running relay — what JTICKET_SYNC_RELAY_URL takes. */
  url: string
  port: number
  dispose(): Promise<void>
}

/**
 * Run a local stand-in for Supabase Realtime Broadcast: join a topic, and every
 * frame you send reaches that topic's other members. Used by the two-instance
 * sync harness so e2e sync runs offline, with no Supabase account involved.
 */
export function startLocalRelay(options?: { port?: number; host?: string }): Promise<LocalRelay>
