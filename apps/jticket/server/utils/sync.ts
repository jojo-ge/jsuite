import type { Explainer, DocNotes } from '@jsuite/documents/store'
import type { Project, Ticket, Doc, TicketComment, ProjectMode } from './store'
import { cleanLabels, coerceProjectMode, isDocStatus, isFinishedStatus, isStatus } from './store'
import type { ProjectShare, ShareSide } from './ownership'
import { isPeerOwned, otherSide } from './ownership'
import { attachmentRefs, docMediaRefs, rewriteAttachmentUrls, rewriteDocMediaUrls, sanitizeAttachmentName } from './bundle'
import { sanitizeDocKey } from '@jsuite/documents/store'
import type { BundleAttachment, BundleDoc, BundleDocMedia, DocMediaRef } from './bundle'

// The snapshot sync engine (TICK-293, spec DOC-30): the pure core of two-party
// project sync. One side builds a per-side filtered export — its owned half of
// a shared project — and the other applies it: wholesale replace of the
// peer-owned set, deletion by absence, per-ticket comment-set merge, never
// touching locally-owned entities. No networking, no filesystem: callers load
// doc bodies / media bytes and perform the returned IO plan, so every merge
// rule stays unit- and property-testable.

export const SYNC_FORMAT = 'jticket-sync-snapshot'

/** A shared-pool body with its notes sidecar — BundleDoc minus the record. */
export interface SyncPoolDocument {
  document: Explainer | null
  documentNotes: DocNotes | null
}

/** Creator-owned project metadata — the only project fields that sync. */
export interface SyncProjectMeta {
  title: string
  description: string
  mode: ProjectMode
}

/** The exporter's comments on tickets it does NOT own, keyed by ticket id. */
export interface SyncTicketComments {
  ticketId: string
  comments: TicketComment[]
}

// A declined ownership transfer, named by the offer's transferAt stamp so a
// stale decline can never kill a re-initiated offer. The decliner keeps
// exporting the entry until the transferor's pull reverts their pending copy
// and re-exports the ticket as plainly theirs (which clears the marker).
export interface SyncTransferDecline {
  ticketId: string
  transferAt: string
}

// The wire payload of one pull: the exporting side's owned half of the shared
// project. Machine-local fields (repo, integration branch, ticket branches)
// never appear. Entity ids are the exporter's and are preserved on apply, so
// they are the stable cross-machine identity of every synced entity.
export interface SyncSnapshot {
  format: typeof SYNC_FORMAT
  version: 1
  exportedAt: string
  /** The side that built this snapshot. */
  side: ShareSide
  sharedKey: string
  /** Project metadata belongs to the link creator; null from the importer. */
  projectMeta: SyncProjectMeta | null
  /** Exporter-owned tickets — plus in-transfer pending ones, whatever their
   * owner reads: both sides keep a pending ticket in their export so transfer
   * limbo survives pulls in either order. */
  tickets: Ticket[]
  peerComments: SyncTicketComments[]
  /** Transfers this side declined — see SyncTransferDecline. */
  transferDeclines: SyncTransferDecline[]
  /** Exporter-owned doc records with their shared-pool bodies inlined. */
  docs: BundleDoc[]
  /** Filled by the caller from attachmentNames / mediaRefs — see SyncExport. */
  attachments: BundleAttachment[]
  media: BundleDocMedia[]
}

export interface SyncExportInput {
  /** The shared project (project.share must be set). */
  project: Project
  /** Every ticket of the project — the builder filters by owner. */
  tickets: Ticket[]
  /** Every doc record of the project — the builder filters by owner. */
  docs: Doc[]
  /** Shared-pool bodies by documentKey; may be a superset of what's needed. */
  documents: Map<string, SyncPoolDocument>
  /** Stamped by the caller — the engine never reads the clock. */
  exportedAt: string
}

export interface SyncExport {
  /** attachments/media are empty — the caller inlines the referenced bytes. */
  snapshot: SyncSnapshot
  /** Every /attachments/<name> the snapshot's text references. */
  attachmentNames: string[]
  /** Every /api/media/<docKey>/… the snapshot's text references. */
  mediaRefs: DocMediaRef[]
}

export interface SyncApplyInput {
  /** The local shared project (project.share must be set). */
  project: Project
  /** The project's local tickets and doc records. */
  tickets: Ticket[]
  docs: Doc[]
  counters: { ticket: number; doc: number }
  /** Every ticket / doc key in the whole store — key adoption must not collide. */
  takenTicketKeys: Iterable<string>
  takenDocKeys: Iterable<string>
  /** Every key present in the local shared document pool. */
  existingDocumentKeys: Iterable<string>
  /** Local pool bodies for the incoming docs' final keys — diffed against. */
  localDocuments: Map<string, SyncPoolDocument>
  /** Local attachment bytes by name (base64); a Map works, so does lazy fs. */
  localAttachments: { get(name: string): string | undefined }
  snapshot: SyncSnapshot
}

export interface SyncDocumentWrite {
  key: string
  document: Explainer
  documentNotes: DocNotes | null
}

export interface SyncChangeSet {
  added: string[]
  changed: string[]
  deleted: string[]
}

/** The local change summary — what this pull did, computed from the diff. */
export interface SyncChangeSummary {
  projectChanged: boolean
  /** Local (post-mapping) ticket / doc keys. */
  tickets: SyncChangeSet
  docs: SyncChangeSet
  comments: { added: number; changed: number; deleted: number }
}

// What one apply produces: the replacement state for the project plus the IO
// plan the caller performs. Store state and summary are strictly idempotent;
// mediaWrites are "ensure these bytes" ops the caller may skip byte-for-byte.
export interface SyncApplyResult {
  project: Project
  /** Full replacement ticket / doc lists for the project. */
  tickets: Ticket[]
  docs: Doc[]
  counters: { ticket: number; doc: number }
  /** Shared-pool bodies to write (already url-rewritten); empty when unchanged. */
  documentWrites: SyncDocumentWrite[]
  /** Pool keys of peer docs deleted by absence. */
  documentDeletes: string[]
  mediaWrites: BundleDocMedia[]
  attachmentWrites: BundleAttachment[]
  /** Incoming entities refused (key parity collision, wrong owner). */
  dropped: string[]
  summary: SyncChangeSummary
}

// ── Export ──────────────────────────────────────────────────────────────────

// Locally-owned = not the peer's: stamped with this side, or unstamped
// (minted before the share existed). Same predicate every handler guards by.
function ownedHere(entity: { owner: ShareSide | '' }, share: ProjectShare): boolean {
  return !isPeerOwned(entity, share)
}

// Unstamped entities travel stamped with the exporting side: '' means "local"
// only on the machine that holds it, while a snapshot needs the absolute side.
function exportStamp(entity: { origin: ShareSide | ''; owner: ShareSide | '' }, side: ShareSide) {
  return { origin: entity.origin || side, owner: side }
}

function exportComment(c: TicketComment, side: ShareSide): TicketComment {
  return {
    id: c.id,
    author: c.author,
    body: c.body,
    createdAt: c.createdAt,
    ...exportStamp(c, side),
  }
}

export function buildSyncExport(input: SyncExportInput): SyncExport {
  const share = input.project.share
  if (!share) throw new Error(`${input.project.key} is not shared`)
  const side = share.side

  const tickets: Ticket[] = []
  const peerComments: SyncTicketComments[] = []
  const transferDeclines: SyncTransferDecline[] = []
  for (const t of input.tickets) {
    const pending = t.transfer === 'pending'
    if (!pending && !ownedHere(t, share)) {
      // Not mine to export — but my comments on it are, and so is the marker
      // for a transfer I declined (the record itself is the peer's again).
      if (t.transfer === 'declined') transferDeclines.push({ ticketId: t.id, transferAt: t.transferAt })
      const comments = t.comments.filter((c) => ownedHere(c, share)).map((c) => exportComment(c, side))
      if (comments.length) peerComments.push({ ticketId: t.id, comments })
      continue
    }
    tickets.push({
      id: t.id,
      key: t.key,
      title: t.title,
      description: t.description,
      acceptanceCriteria: [...t.acceptanceCriteria],
      type: t.type,
      status: t.status,
      // The receiving side owns its project record; local ids stay home.
      projectId: null,
      assignee: t.assignee,
      labels: [...t.labels],
      resolution: t.resolution,
      blockedBy: [...t.blockedBy],
      comments: t.comments.filter((c) => ownedHere(c, share)).map((c) => exportComment(c, side)),
      // The work branch lives in this machine's clone — machine-local.
      branch: '',
      completedAt: t.completedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      // A pending ticket travels exactly as it stands — owner already names
      // the transferee on both machines, and an export claiming '' would read
      // as settled ownership and finalize the transferor early.
      origin: t.origin || side,
      owner: pending ? t.owner : side,
      transfer: pending ? 'pending' : '',
      transferAt: pending ? t.transferAt : '',
    })
  }

  const docs: BundleDoc[] = []
  for (const d of input.docs) {
    if (!ownedHere(d, share)) continue
    const pool = d.documentKey ? input.documents.get(d.documentKey) : undefined
    docs.push({
      record: {
        id: d.id,
        key: d.key,
        title: d.title,
        documentKey: d.documentKey,
        projectId: null,
        labels: [...d.labels],
        status: d.status,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        ...exportStamp(d, side),
      },
      document: pool?.document ?? null,
      documentNotes: pool?.document ? (pool.documentNotes ?? null) : null,
    })
  }

  const snapshot: SyncSnapshot = {
    format: SYNC_FORMAT,
    version: 1,
    exportedAt: input.exportedAt,
    side,
    sharedKey: share.key,
    projectMeta: side === 'creator'
      ? { title: input.project.title, description: input.project.description, mode: input.project.mode }
      : null,
    tickets,
    peerComments,
    transferDeclines,
    docs,
    attachments: [],
    media: [],
  }

  // Sweep the snapshot itself, so only text that actually travels can pull a
  // file in — a ref living solely in peer-owned text stays the peer's problem.
  const text = JSON.stringify(snapshot)
  return {
    snapshot,
    attachmentNames: [...attachmentRefs(text)],
    mediaRefs: docMediaRefs(text),
  }
}

// ── Apply ───────────────────────────────────────────────────────────────────

function validSide(v: unknown): v is ShareSide {
  return v === 'creator' || v === 'importer'
}

const strOr = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v ? v : fallback

// Reserve the keys this pull must not hand out: everything locally owned,
// plus peer copies that survive (id-matched), plus tickets in transfer limbo
// — a pending ticket is immune to absence-deletion, so its key lives on even
// when the snapshot lacks it. A peer entity dying by absence releases its
// key, so the peer set can be replaced without self-colliding.
function reserveSurvivorKeys(
  reserved: Set<string>,
  entities: Array<{ id: string; key: string; owner: ShareSide | ''; transfer?: string }>,
  incomingIds: Set<unknown>,
  share: ProjectShare,
): void {
  for (const e of entities) {
    if (ownedHere(e, share) || incomingIds.has(e.id) || e.transfer === 'pending') reserved.add(e.key)
    else reserved.delete(e.key)
  }
}

// Incoming comments are remote-authored: rebuilt field by field, never spread.
function sanitizeIncomingComment(
  c: TicketComment,
  peer: ShareSide,
  fallbackAt: string,
  fixText: (text: string) => string,
): TicketComment | null {
  if (!c || typeof c.id !== 'string' || !c.id) return null
  if (c.owner !== peer) return null
  const body = String(c.body ?? '')
  if (!body) return null
  return {
    id: c.id,
    author: String(c.author ?? '').trim() || 'anonymous',
    body: fixText(body),
    createdAt: strOr(c.createdAt, fallbackAt),
    origin: validSide(c.origin) ? c.origin : peer,
    owner: peer,
  }
}

// Deterministic comment order — merged sets read the same on every pull.
function byCommentOrder(a: TicketComment, b: TicketComment): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

// Ticket equality for the change summary, comments aside — comment changes
// are counted as comment events, not as a "changed" ticket.
//
// Key order is not meaning. A ticket read off disk and one just built by
// ingest can hold identical values in a different order — a field added in a
// later version lands mid-object in the fresh one and at the end of the
// migrated one — and a plain stringify would call that a change on every
// ticket, on every pull, forever. Compare a key-sorted projection instead.
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}
function sameTicketRecord(a: Ticket, b: Ticket): boolean {
  return canonicalJson({ ...a, comments: [] }) === canonicalJson({ ...b, comments: [] })
}

function splitAttachmentName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: '' }
}

export function applySyncSnapshot(input: SyncApplyInput): SyncApplyResult {
  const share = input.project.share
  if (!share) throw new Error(`${input.project.key} is not shared`)
  const snap = input.snapshot
  if (!snap || snap.format !== SYNC_FORMAT || snap.version !== 1) {
    throw new Error('not a jticket sync snapshot')
  }
  const peer = otherSide(share.side)
  if (snap.side !== peer) throw new Error(`snapshot must come from the peer side (${peer}), got '${snap.side}'`)
  if (snap.sharedKey !== share.key) {
    throw new Error(`snapshot shared key '${snap.sharedKey}' does not match this project's '${share.key}'`)
  }
  const fallbackAt = strOr(snap.exportedAt, '')

  // Counter-key adoption, shared by non-parity ticket keys and doc record
  // keys: a free key is adopted (bumping the counter past it so later local
  // mints can't collide), a taken one is re-minted from the local counter.
  const adoptOrMint = (key: string, kind: 'ticket' | 'doc', reserved: Set<string>): string => {
    const prefix = kind === 'ticket' ? 'TICK' : 'DOC'
    if (!reserved.has(key)) {
      const m = new RegExp(`^${prefix}-(\\d+)$`).exec(key)
      if (m) counters[kind] = Math.max(counters[kind], Number(m[1]))
      return key
    }
    while (reserved.has(`${prefix}-${counters[kind] + 1}`)) counters[kind]++
    counters[kind]++
    return `${prefix}-${counters[kind]}`
  }

  const counters = { ...input.counters }
  const dropped: string[] = []
  const summary: SyncChangeSummary = {
    projectChanged: false,
    tickets: { added: [], changed: [], deleted: [] },
    docs: { added: [], changed: [], deleted: [] },
    comments: { added: 0, changed: 0, deleted: 0 },
  }

  // Locally-owned SETTLED entities are untouchable — collect their ids so an
  // incoming id collision (peer bug or hostile snapshot) is refused, not
  // merged. A pending offer held here reads as this side's owner but is not
  // settled: the peer's limbo export may still update or finalize it.
  const localIds = new Set<string>()
  for (const t of input.tickets) if (ownedHere(t, share) && t.transfer !== 'pending') localIds.add(t.id)
  for (const d of input.docs) if (ownedHere(d, share)) localIds.add(d.id)

  // ── Attachments — before any text lands, so renames can rewrite it ──
  // Same namespace rule as bundle import: identical bytes are reused, a name
  // held by different bytes gets a suffixed copy. Probing walks the suffixes,
  // so the rename a mismatch produced on one pull is found again on the next.
  const attachmentRenames = new Map<string, string>()
  const attachmentWrites: BundleAttachment[] = []
  const seenAttachments = new Set<string>()
  for (const a of snap.attachments ?? []) {
    const name = sanitizeAttachmentName(a?.name)
    const base64 = String(a?.base64 ?? '')
    if (!name || !base64 || seenAttachments.has(name)) continue
    seenAttachments.add(name)
    const { base, ext } = splitAttachmentName(name)
    for (let i = 1; i < 500; i++) {
      const candidate = i === 1 ? name : `${base}-${i}${ext}`
      const local = input.localAttachments.get(candidate)
      if (local !== undefined && local !== base64) continue
      if (candidate !== name) attachmentRenames.set(name, candidate)
      if (local === undefined) attachmentWrites.push({ name: candidate, base64 })
      break
    }
  }
  const fixAttachmentUrls = (text: string): string => rewriteAttachmentUrls(text, attachmentRenames)

  // ── Doc records — key assignment before ticket/doc text, so pool-key
  // renames can rewrite /api/media/ urls in everything that follows ──
  const localPeerDocs = new Map(input.docs.filter((d) => !ownedHere(d, share)).map((d) => [d.id, d]))

  // Record keys (DOC-n) come from each side's global counter, so unlike parity
  // ticket keys they can collide across the two machines: a free key is
  // adopted (bumping the local counter past it), a taken one is re-minted
  // locally — and either way the mapping is stable, keyed by the entity id.
  const reservedDocKeys = new Set(input.takenDocKeys)
  reserveSurvivorKeys(reservedDocKeys, input.docs, new Set((snap.docs ?? []).map((e) => e?.record?.id).filter(Boolean)), share)

  // Pool keys: taken = everything in the local pool plus what this pull
  // assigns. A previously assigned (possibly suffixed) key is recognized by
  // the /^desired(-\d+)?$/ shape and reused, keeping pulls idempotent.
  const takenPoolKeys = new Set(input.existingDocumentKeys)
  const docKeyRenames = new Map<string, string>()
  const assignPoolKey = (desired: string, existing: Doc | undefined): string => {
    if (!desired) return ''
    if (existing && (existing.documentKey === desired || new RegExp(`^${desired}-\\d+$`).test(existing.documentKey))) {
      if (existing.documentKey !== desired && !docKeyRenames.has(desired)) {
        docKeyRenames.set(desired, existing.documentKey)
      }
      takenPoolKeys.add(existing.documentKey)
      return existing.documentKey
    }
    for (let i = 1; i < 1000; i++) {
      const candidate = i === 1 ? desired : `${desired}-${i}`
      if (takenPoolKeys.has(candidate)) continue
      takenPoolKeys.add(candidate)
      if (candidate !== desired && !docKeyRenames.has(desired)) docKeyRenames.set(desired, candidate)
      return candidate
    }
    return desired
  }

  interface IncomingDocEntry {
    record: Doc
    document: Explainer | null
    documentNotes: DocNotes | null
    existing: Doc | undefined
  }
  const incomingDocs = new Map<string, IncomingDocEntry>()
  for (const entry of snap.docs ?? []) {
    const d = entry?.record
    if (!d || typeof d.id !== 'string' || !d.id) continue
    const key = String(d.key ?? '')
    const title = String(d.title ?? '').trim()
    if (d.owner !== peer || localIds.has(d.id) || !key || !title || incomingDocs.has(d.id)) {
      if (key) dropped.push(key)
      continue
    }
    const existing = localPeerDocs.get(d.id)
    const finalKey = existing ? existing.key : adoptOrMint(key, 'doc', reservedDocKeys)
    reservedDocKeys.add(finalKey)
    incomingDocs.set(d.id, {
      record: {
        id: d.id,
        key: finalKey,
        title,
        documentKey: assignPoolKey(sanitizeDocKey(d.documentKey), existing),
        projectId: input.project.id,
        labels: cleanLabels(d.labels),
        status: isDocStatus(d.status) ? d.status : 'draft',
        origin: validSide(d.origin) ? d.origin : peer,
        owner: peer,
        createdAt: strOr(d.createdAt, fallbackAt),
        updatedAt: strOr(d.updatedAt, fallbackAt),
      },
      document: entry.document ?? null,
      documentNotes: entry.documentNotes ?? null,
      existing,
    })
  }

  // Every incoming text passes through here: attachment renames + pool-key
  // renames, applied before anything is compared or stored.
  const fixText = (text: string): string => rewriteDocMediaUrls(fixAttachmentUrls(text), docKeyRenames)

  // ── Tickets ──
  // Keyed by id across ALL local copies (peer-owned, pending, declined): the
  // stable cross-machine identity every incoming ticket resolves against.
  const localTicketsById = new Map(input.tickets.map((t) => [t.id, t]))

  // Parity keys are collision-free by construction, so a clash with a
  // locally-owned ticket means broken parity or a hostile snapshot — refuse
  // the ticket. Pre-share TICK-n keys get the adopt-or-remint treatment.
  // Peer keys are reserved only where the peer copy survives this pull
  // (id-matched): a peer ticket dying by absence releases its key, so the
  // whole peer set can be replaced without colliding with itself.
  const reservedTicketKeys = new Set(input.takenTicketKeys)
  reserveSurvivorKeys(reservedTicketKeys, input.tickets, new Set((snap.tickets ?? []).map((t) => t?.id).filter(Boolean)), share)

  // Offers this apply refused only because they were already declined here —
  // the merge loop keeps those declined copies alive instead of reading the
  // skipped offer as an absence-deletion of them.
  const staleOfferIds = new Set<string>()

  const incomingTickets = new Map<string, Ticket>()
  for (const t of snap.tickets ?? []) {
    if (!t || typeof t.id !== 'string' || !t.id) continue
    const key = String(t.key ?? '')
    const title = String(t.title ?? '').trim()
    const pending = t.transfer === 'pending'
    // Whose copy may this become? The peer's own half always; this side's
    // owner is accepted only as a pending transfer offer.
    const incomingOwner: ShareSide | null = t.owner === peer ? peer : pending && t.owner === share.side ? share.side : null
    if (incomingOwner === null || !key || !title || incomingTickets.has(t.id)) {
      if (key) dropped.push(key)
      continue
    }
    const local = localTicketsById.get(t.id)
    if (pending && incomingOwner === share.side) {
      // The accepted-but-not-finalized window: the peer still exports the
      // offer while this side already owns the ticket outright. Ignored, not
      // an error — the peer's next pull finalizes and stops the re-offer.
      // (Also swallows hostile offers reusing a settled local id.)
      if (localIds.has(t.id)) continue
      // Already declined, same offer: keep saying no until the peer reverts.
      if (local?.transfer === 'declined' && local.transferAt === String(t.transferAt ?? '')) {
        staleOfferIds.add(t.id)
        continue
      }
    } else if (localIds.has(t.id)) {
      dropped.push(key)
      continue
    }
    // Reaching here, any local copy is peer-owned or in transfer (settled
    // local ids were screened above) — either way it anchors the key.
    const existing = local
    let finalKey: string
    if (existing) {
      finalKey = existing.key
    } else if (key.startsWith(`${share.key}-`)) {
      // Reserved despite the peer set's own keys having been released above
      // means a locally-owned ticket (or another project) holds it — broken
      // parity or a hostile snapshot. Refuse the ticket, never remap parity.
      if (reservedTicketKeys.has(key)) {
        dropped.push(key)
        continue
      }
      finalKey = key
    } else {
      finalKey = adoptOrMint(key, 'ticket', reservedTicketKeys)
    }
    reservedTicketKeys.add(finalKey)
    const finished = isFinishedStatus(t.status)
    const blockedBy = [...new Set((t.blockedBy ?? []).map((r) => String(r)).filter((r) => r && r !== t.id))]
    incomingTickets.set(t.id, {
      id: t.id,
      key: finalKey,
      title,
      description: fixText(String(t.description ?? '')),
      acceptanceCriteria: (t.acceptanceCriteria ?? []).map((s) => String(s)).filter(Boolean),
      type: t.type === 'HITL' ? 'HITL' : 'AFK',
      status: isStatus(t.status) ? t.status : 'todo',
      projectId: input.project.id,
      assignee: String(t.assignee ?? '').trim(),
      labels: cleanLabels(t.labels),
      resolution: fixText(String(t.resolution ?? '')),
      blockedBy,
      comments: (t.comments ?? [])
        .map((c) => sanitizeIncomingComment(c, peer, fallbackAt, fixText))
        .filter((c): c is TicketComment => !!c)
        .sort(byCommentOrder),
      branch: '', // the peer's work branch is machine-local to the peer
      // Same for their hand-off prompt: a dispatch override describes their
      // machine, and a peer-owned ticket is undispatchable here anyway.
      prompt: '',
      promptMode: '',
      completedAt: finished ? (t.completedAt ?? t.updatedAt ?? fallbackAt) : null,
      origin: validSide(t.origin) ? t.origin : peer,
      owner: incomingOwner,
      // Only 'pending' crosses the wire as a ticket field — declines travel
      // as transferDeclines entries, and anything else reads as settled.
      transfer: pending ? 'pending' : '',
      transferAt: pending ? strOr(t.transferAt, fallbackAt) : '',
      createdAt: strOr(t.createdAt, fallbackAt),
      updatedAt: strOr(t.updatedAt, fallbackAt),
    })
  }

  // ── Comment-set merge — per ticket, each comment kept by its owner ──
  // The peer's subset is replaced wholesale (their absence deletes), local
  // comments are kept verbatim, and a merged set reads in one stable order.
  const peerCommentSets = new Map<string, TicketComment[]>()
  for (const e of snap.peerComments ?? []) {
    if (!e || typeof e.ticketId !== 'string' || peerCommentSets.has(e.ticketId)) continue
    peerCommentSets.set(e.ticketId, (e.comments ?? [])
      .map((c) => sanitizeIncomingComment(c, peer, fallbackAt, fixText))
      .filter((c): c is TicketComment => !!c))
  }
  const mergeComments = (kept: TicketComment[], incoming: TicketComment[]): TicketComment[] => {
    // An incoming id colliding with a locally-owned comment is refused — the
    // local one wins, same rule as entity ids.
    const keptIds = new Set(kept.map((c) => c.id))
    return [...kept, ...incoming.filter((c) => !keptIds.has(c.id))].sort(byCommentOrder)
  }
  const diffPeerComments = (prev: TicketComment[], next: TicketComment[]): void => {
    const prevById = new Map(prev.filter((c) => c.owner === peer).map((c) => [c.id, c]))
    for (const c of next) {
      if (c.owner !== peer) continue
      const p = prevById.get(c.id)
      if (!p) summary.comments.added++
      else if (JSON.stringify(p) !== JSON.stringify(c)) summary.comments.changed++
      prevById.delete(c.id)
    }
    summary.comments.deleted += prevById.size
  }

  // Declines the peer sent: offer stamps by ticket id. Only a pending copy
  // this side gave away (owner = peer) reverts, and only on an exact
  // transferAt match — a stale decline never touches a re-initiated offer.
  const declines = new Map<string, string>()
  for (const d of snap.transferDeclines ?? []) {
    if (d && typeof d.ticketId === 'string' && d.ticketId) declines.set(d.ticketId, String(d.transferAt ?? ''))
  }

  const tickets: Ticket[] = []
  const replaceWith = (t: Ticket, next: Ticket): void => {
    incomingTickets.delete(t.id)
    const merged = mergeComments(t.comments.filter((c) => c.owner !== peer), next.comments)
    const replacement = { ...next, comments: merged }
    tickets.push(replacement)
    if (!sameTicketRecord(replacement, t)) summary.tickets.changed.push(replacement.key)
    diffPeerComments(t.comments, merged)
  }
  for (const t of input.tickets) {
    if (t.transfer === 'pending') {
      // Transfer limbo. Whatever the peer exports for it wins — their limbo
      // copy (no-op), a re-offer, or the accepted ticket as plainly theirs
      // (finalize: this side's frozen copy becomes a normal peer ticket and
      // leaves the export set). Absent from the snapshot, it survives: a
      // pending ticket is immune to absence-deletion (spec DOC-30) — unless
      // the peer declined this exact offer, which bounces it back here.
      const next = incomingTickets.get(t.id)
      if (next) {
        replaceWith(t, next)
      } else if (isPeerOwned(t, share) && declines.get(t.id) === t.transferAt) {
        // Bounced back. The decliner's comments on it ride this same
        // snapshot's peerComments (the ticket is peer-owned on their side),
        // so merge them now rather than leaving the first post-decline pull
        // incomplete.
        const incoming = peerCommentSets.get(t.id)
        let comments = t.comments
        if (incoming !== undefined || t.comments.some((c) => c.owner === peer)) {
          comments = mergeComments(t.comments.filter((c) => c.owner !== peer), incoming ?? [])
          diffPeerComments(t.comments, comments)
        }
        tickets.push({ ...t, owner: share.side, transfer: '', transferAt: '', comments })
        summary.tickets.changed.push(t.key)
      } else {
        tickets.push(t)
      }
      continue
    }
    if (t.transfer === 'declined') {
      // The bounced copy holds its ground against the stale re-offer it
      // already declined; anything else the peer exports for it (or true
      // absence, once they revert and delete) applies as usual.
      const next = incomingTickets.get(t.id)
      if (next) replaceWith(t, next)
      else if (staleOfferIds.has(t.id)) tickets.push(t)
      else summary.tickets.deleted.push(t.key)
      continue
    }
    if (ownedHere(t, share)) {
      const incoming = peerCommentSets.get(t.id)
      if (incoming === undefined && !t.comments.some((c) => c.owner === peer)) {
        tickets.push(t) // nothing of the peer's here, before or now — untouched
        continue
      }
      const merged = mergeComments(t.comments.filter((c) => c.owner !== peer), incoming ?? [])
      diffPeerComments(t.comments, merged)
      tickets.push(JSON.stringify(merged) === JSON.stringify(t.comments) ? t : { ...t, comments: merged })
      continue
    }
    const next = incomingTickets.get(t.id)
    if (!next) {
      summary.tickets.deleted.push(t.key)
      continue // deletion by absence
    }
    replaceWith(t, next)
  }
  for (const next of incomingTickets.values()) {
    tickets.push(next)
    summary.tickets.added.push(next.key)
  }

  // ── Docs — final list, pool writes gated on an actual diff ──
  const documentWrites: SyncDocumentWrite[] = []
  const docs: Doc[] = []
  const deletedDocs: Doc[] = []
  const placeDoc = (entry: IncomingDocEntry): void => {
    docs.push(entry.record)
    let bodyChanged = false
    if (entry.document && entry.record.documentKey) {
      const document = JSON.parse(fixText(JSON.stringify({ ...entry.document, key: entry.record.documentKey }))) as Explainer
      const documentNotes = entry.documentNotes
        ? (JSON.parse(fixText(JSON.stringify(entry.documentNotes))) as DocNotes)
        : null
      const local = input.localDocuments.get(entry.record.documentKey)
      bodyChanged = !local
        || JSON.stringify(local.document) !== JSON.stringify(document)
        || JSON.stringify(local.documentNotes ?? null) !== JSON.stringify(documentNotes)
      if (bodyChanged) documentWrites.push({ key: entry.record.documentKey, document, documentNotes })
    }
    if (!entry.existing) {
      summary.docs.added.push(entry.record.key)
    } else if (JSON.stringify(entry.record) !== JSON.stringify(entry.existing) || bodyChanged) {
      summary.docs.changed.push(entry.record.key)
    }
  }
  for (const d of input.docs) {
    if (ownedHere(d, share)) {
      docs.push(d)
      continue
    }
    const next = incomingDocs.get(d.id)
    if (!next) {
      summary.docs.deleted.push(d.key)
      deletedDocs.push(d)
      continue
    }
    incomingDocs.delete(d.id)
    placeDoc(next)
  }
  for (const next of incomingDocs.values()) placeDoc(next)

  // A deleted peer doc's pool body goes too — unless a surviving record (peer
  // or local) still points at the same pool key.
  const referencedPoolKeys = new Set(docs.map((d) => d.documentKey).filter(Boolean))
  const documentDeletes = [...new Set(
    deletedDocs.map((d) => d.documentKey).filter((k) => k && !referencedPoolKeys.has(k)),
  )]

  // ── Media — bytes for the docs that just landed, under their final keys.
  // "Ensure these bytes" ops: the caller skips byte-identical files, so the
  // list may repeat across pulls without breaking idempotence of state.
  const mediaWrites: BundleDocMedia[] = []
  const seenMedia = new Set<string>()
  for (const m of snap.media ?? []) {
    const name = sanitizeAttachmentName(m?.name)
    const desired = sanitizeDocKey(m?.docKey)
    const base64 = String(m?.base64 ?? '')
    if (!name || !desired || !base64) continue
    const docKey = docKeyRenames.get(desired) ?? desired
    const notes = !!m.notes
    const dedupe = `${docKey}/${notes ? 'notes/' : ''}${name}`
    if (seenMedia.has(dedupe)) continue
    seenMedia.add(dedupe)
    mediaWrites.push({ docKey, name, notes, base64 })
  }

  // ── Project metadata — the creator's, applied only on the importer side ──
  let project = input.project
  if (share.side === 'importer' && snap.side === 'creator' && snap.projectMeta) {
    const meta = snap.projectMeta
    const title = String(meta.title ?? '').trim()
    const next: Project = {
      ...project,
      title: title || project.title,
      description: fixText(String(meta.description ?? '')),
      mode: coerceProjectMode(meta.mode),
    }
    if (next.title !== project.title || next.description !== project.description || next.mode !== project.mode) {
      project = next
      summary.projectChanged = true
    }
  }

  return {
    project,
    tickets,
    docs,
    counters,
    documentWrites,
    documentDeletes,
    mediaWrites,
    attachmentWrites,
    dropped,
    summary,
  }
}
