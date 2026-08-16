<script setup lang="ts">
const route = useRoute()
const repo = computed(() => String(route.query.repo ?? ''))

const { data: info } = useFetch<{ slug: string, viewer?: string }>('/api/repo', { query: { repo } })
useHead(() => ({ title: info.value?.slug ? `${info.value.slug} — pull requests` : 'pull requests' }))

// The server caches the gh list for a minute; ↻ busts it with a fresh
// force stamp, while plain navigation gets the instant cached answer.
const force = ref<string | undefined>(undefined)
const { data: prs, pending, error } = useFetch<any[]>('/api/prs', { query: { repo, force } })
function refresh() {
  force.value = String(Date.now())
}

const hideDrafts = ref(false)
const onlyMine = ref(false)
const imReviewing = ref(false)
const teamReviewing = ref(false)
const authorFilter = ref<string[]>([])

// Kick off the combined claude run (rating, risk map, tour, ask yourself)
// straight from the list; the job runs server-side, so the row just badges
// as busy and the artifacts are waiting when the PR is opened.
const { isRunning, startAll, cancel, running } = useAiTasksHub(repo)

// Runs live on the server, so they outlive this tab: the section below is the
// one place that shows everything analyzing right now — including runs started
// from a PR page, a branch review, or before a reload.
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => { tick = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => { if (tick) clearInterval(tick) })

function elapsed(startedAt: number | null): string {
  if (startedAt == null) return 'starting'
  const s = Math.max(0, Math.round((now.value - startedAt) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// Job ids are storeKeys: a bare number for PRs, "branch/<name>" otherwise.
function jobLink(job: { id: string }) {
  return job.id.startsWith('branch/')
    ? { path: '/branch', query: { repo: repo.value, branch: job.id.slice('branch/'.length) } }
    : { path: `/pr/${job.id}`, query: { repo: repo.value } }
}

function jobLabel(job: { id: string }): string {
  return job.id.startsWith('branch/') ? job.id.slice('branch/'.length) : `#${job.id}`
}

// PR titles come from the list we already have; a branch run has no title
// beyond its name, which the label already carries.
function jobTitle(job: { id: string }): string {
  if (job.id.startsWith('branch/')) return ''
  return (prs.value ?? []).find(pr => String(pr.number) === job.id)?.title ?? ''
}

// gh's reviewRequests mixes users (login) and teams (slug/name, no login).
function reviewRequestedOfMe(pr: any): boolean {
  return (pr.reviewRequests ?? []).some((r: any) => r.login && r.login === info.value?.viewer)
}
function reviewRequestedOfTeam(pr: any): boolean {
  return (pr.reviewRequests ?? []).some((r: any) => !r.login && (r.slug || r.name))
}

// Everything except the author filter, so the people strip below can be built
// from it: only authors you could actually select into a result get a chip.
const matchesOthers = computed(() => (prs.value ?? []).filter(pr =>
  (!hideDrafts.value || !pr.isDraft)
  && (!onlyMine.value || pr.author?.login === info.value?.viewer)
  // The two reviewer filters widen each other: either checked alone narrows
  // to it, both checked keeps PRs matching either.
  && (!(imReviewing.value || teamReviewing.value)
    || (imReviewing.value && reviewRequestedOfMe(pr))
    || (teamReviewing.value && reviewRequestedOfTeam(pr))),
))

// One chip per person with a PR in the list — gh only lists open and draft
// PRs, so nobody without live work shows up. Busiest first, then alphabetical.
const authors = computed(() => {
  const by = new Map<string, { login: string, name?: string, count: number }>()
  for (const pr of matchesOthers.value) {
    const login = pr.author?.login
    if (!login) continue
    const seen = by.get(login)
    if (seen) seen.count++
    else by.set(login, { login, name: pr.author?.name, count: 1 })
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.login.localeCompare(b.login))
})

// A busy open-source repo can have 30+ authors, which is three rows of faces
// before you reach the PRs. Show the busiest handful and let the rest unfold —
// anyone already selected stays visible so a filter is never hidden.
const COLLAPSED = 14
const expanded = ref(false)
const visibleAuthors = computed(() => {
  if (expanded.value || authors.value.length <= COLLAPSED) return authors.value
  return authors.value.filter((a, i) => i < COLLAPSED || authorFilter.value.includes(a.login))
})

// A chip can vanish when another filter changes; drop it from the selection
// rather than leaving an invisible filter that empties the list.
watch(authors, (list) => {
  const live = new Set(list.map(a => a.login))
  authorFilter.value = authorFilter.value.filter(login => live.has(login))
})

function toggleAuthor(login: string) {
  authorFilter.value = authorFilter.value.includes(login)
    ? authorFilter.value.filter(l => l !== login)
    : [...authorFilter.value, login]
}

const matches = computed(() => matchesOthers.value.filter(pr =>
  !authorFilter.value.length || authorFilter.value.includes(pr.author?.login),
))

// Running analyze on a PR is how you mark the ones you're actually reviewing,
// so those come first — a landed rating or a live run both count, which keeps
// a PR from jumping groups the moment its run finishes. gh's recently-updated
// order holds inside each group.
function isReviewing(pr: any): boolean {
  return pr.ratingScore != null || isRunning(pr.number)
}
const reviewingCount = computed(() => matches.value.filter(isReviewing).length)
const filtered = computed(() => [
  ...matches.value.filter(isReviewing),
  ...matches.value.filter(pr => !isReviewing(pr)),
])
</script>

<template>
  <main class="prs">
    <header class="bar">
      <NuxtLink to="/" class="brand">jDiff</NuxtLink>
      <span class="slug">{{ info?.slug ?? repo }}</span>
      <span class="tab on">pull requests</span>
      <NuxtLink :to="{ path: '/branches', query: { repo } }" class="tab">local branches</NuxtLink>
      <button class="refresh" :disabled="pending" @click="refresh()">↻</button>
      <NotificationBell :repo="repo" />
    </header>

    <div class="filters">
      <label class="filter">
        <input v-model="hideDrafts" type="checkbox">
        hide drafts
      </label>
      <label class="filter">
        <input v-model="onlyMine" type="checkbox">
        only mine
      </label>
      <label class="filter">
        <input v-model="imReviewing" type="checkbox">
        i'm reviewing
      </label>
      <label class="filter">
        <input v-model="teamReviewing" type="checkbox">
        my team is reviewing
      </label>
    </div>

    <section v-if="running.length" class="jobs">
      <h2 class="jobs-label">analyzing now <span class="jobs-count">{{ running.length }}</span></h2>
      <ul class="jobs-list">
        <li v-for="job in running" :key="job.id" class="job">
          <span class="spinner tiny" />
          <NuxtLink :to="jobLink(job)" class="job-target">{{ jobLabel(job) }}</NuxtLink>
          <span class="job-title">{{ jobTitle(job) }}</span>
          <span class="job-elapsed">{{ elapsed(job.startedAt) }}</span>
          <button class="job-cancel" title="stop this run" @click="cancel(job.target)">cancel</button>
          <p v-if="job.lastLog" class="job-log">{{ job.lastLog }}</p>
        </li>
      </ul>
    </section>

    <div v-if="authors.length > 1" class="people">
      <span class="people-label">people</span>
      <button
        v-for="a in visibleAuthors"
        :key="a.login"
        class="person"
        :class="{ on: authorFilter.includes(a.login), dim: authorFilter.length && !authorFilter.includes(a.login) }"
        :aria-pressed="authorFilter.includes(a.login)"
        :title="`${a.name ? `${a.name} — ` : ''}${a.login} · ${a.count} open`"
        @click="toggleAuthor(a.login)"
      >
        <AuthorAvatar :login="a.login" :size="26" />
        <span v-if="a.count > 1" class="count">{{ a.count }}</span>
        <span class="sr">{{ a.login }}, {{ a.count }} open</span>
      </button>
      <button
        v-if="authors.length > visibleAuthors.length || (expanded && authors.length > COLLAPSED)"
        class="more"
        @click="expanded = !expanded"
      >{{ expanded ? 'less' : `+${authors.length - visibleAuthors.length}` }}</button>
      <button v-if="authorFilter.length" class="more" @click="authorFilter = []">clear</button>
    </div>

    <div v-if="pending" class="center"><span class="spinner" /></div>
    <div v-else-if="error" class="error-box">{{ fetchErrorMessage(error) }}</div>
    <div v-else-if="!prs?.length" class="center muted">no open pull requests</div>
    <div v-else-if="!filtered.length" class="center muted">no pull requests match the filters</div>

    <ul v-else class="list">
      <template v-for="(pr, i) in filtered" :key="pr.number">
        <li
          v-if="i === reviewingCount && reviewingCount"
          class="split"
        >not analyzed yet</li>
        <li>
          <NuxtLink :to="{ path: `/pr/${pr.number}`, query: { repo } }" class="pr">
            <div class="top">
              <span class="number">#{{ pr.number }}</span>
              <span class="title">{{ pr.title }}</span>
              <span v-if="pr.isDraft" class="badge draft">draft</span>
              <span v-else-if="pr.reviewDecision === 'APPROVED'" class="badge approved">approved</span>
              <span v-else-if="pr.reviewDecision === 'CHANGES_REQUESTED'" class="badge changes">changes</span>
              <span
                v-if="pr.ratingScore != null"
                class="badge score"
                :class="pr.ratingScore >= 7 ? 'good' : pr.ratingScore >= 4 ? 'mid' : 'bad'"
              >✦ {{ pr.ratingScore }}/10</span>
              <span class="row-tools">
                <span v-if="isRunning(pr.number)" class="badge running">
                  <span class="spinner tiny" /> analyzing
                </span>
                <button
                  v-else
                  class="analyze-btn"
                  title="run all review tools on this PR in the background"
                  @click.prevent.stop="startAll(pr.number)"
                >✦ analyze</button>
              </span>
            </div>
            <div class="meta">
              <span class="who">
                <AuthorAvatar :login="pr.author?.login" :size="16" />
                {{ pr.author?.login }}
              </span>
              <span class="branch">{{ pr.headRefName }} → {{ pr.baseRefName }}</span>
              <span>{{ timeAgo(pr.updatedAt) }}</span>
              <span class="stats">
                <span class="add">+{{ pr.additions }}</span>
                <span class="del">−{{ pr.deletions }}</span>
              </span>
            </div>
          </NuxtLink>
        </li>
      </template>
    </ul>
  </main>
</template>

<style scoped>
.prs {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px;
}
.bar {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 20px;
}
.brand {
  font-family: var(--mono);
  font-weight: 700;
  color: var(--text);
}
.slug {
  font-weight: 600;
  color: var(--muted);
}
.tab {
  font-size: 12px;
  color: var(--muted);
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
}
.tab:hover { color: var(--text); }
.tab.on {
  color: var(--text);
  border-color: var(--border);
  background: var(--panel);
}
.refresh {
  margin-left: auto;
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.refresh:hover { border-color: var(--accent); }
.filters {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}
.filter {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}
.filter input {
  accent-color: var(--accent);
  cursor: pointer;
}
.jobs {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 10px 16px 12px;
  margin-bottom: 14px;
}
.jobs-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.jobs-count { color: var(--accent); }
.jobs-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.job {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  padding: 6px 0;
}
.job + .job { border-top: 1px solid var(--border); }
.job .spinner.tiny { align-self: center; }
.job-target {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--accent);
}
.job-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.job-elapsed {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.job-cancel {
  font-family: var(--mono);
  font-size: 11px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  border-radius: 6px;
  padding: 2px 10px;
  cursor: pointer;
}
.job-cancel:hover { color: var(--red); border-color: var(--red); }
.job-cancel:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.job-log {
  flex-basis: 100%;
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.4;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.people {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.people-label {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  margin-right: 2px;
}
/* Avatar-only chips: the face is the label, so 38 authors still fit in a
   couple of rows. Name and PR count live in the tooltip and screen-reader text. */
.person {
  position: relative;
  display: inline-flex;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  cursor: pointer;
  transition: opacity 0.12s ease, box-shadow 0.12s ease;
}
/* Nothing is dimmed until a filter is on — then the unpicked faces recede
   so the picked ones read at a glance. */
.person.dim { opacity: 0.4; }
.person:hover { opacity: 1; }
.person.on {
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
}
.person:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.person .count {
  position: absolute;
  right: -3px;
  bottom: -3px;
  min-width: 14px;
  padding: 0 3px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel-2);
  font-family: var(--mono);
  font-size: 9px;
  line-height: 12px;
  color: var(--muted);
}
.person.on .count { color: var(--accent); border-color: var(--accent); }
.more {
  font-family: var(--mono);
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--panel);
  color: var(--muted);
  padding: 5px 10px;
  cursor: pointer;
}
.more:hover { color: var(--text); border-color: var(--accent); }
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .person { transition: none; }
}
.center {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}
.muted { color: var(--muted); }
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.list li + li { border-top: 1px solid var(--border); }
/* Marks where the ones you've analyzed stop and the rest begin. */
.split {
  padding: 5px 16px;
  background: var(--panel-2);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.pr {
  display: block;
  padding: 12px 16px;
  color: var(--text);
  background: var(--panel);
}
.pr:hover {
  background: var(--panel-2);
  text-decoration: none;
}
.top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.number {
  font-family: var(--mono);
  color: var(--muted);
}
.title { font-weight: 600; }
.badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
}
.badge.draft { color: var(--muted); }
.badge.approved { color: var(--green); border-color: var(--green); }
.badge.changes { color: var(--red); border-color: var(--red); }
.badge.score { font-family: var(--mono); }
.row-tools {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
}
.badge.running {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  color: var(--accent);
  border-color: var(--accent);
}
.analyze-btn {
  font-family: var(--mono);
  font-size: 11px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  border-radius: 6px;
  padding: 2px 10px;
  cursor: pointer;
}
.analyze-btn:hover { color: var(--text); border-color: var(--accent); }
.spinner.tiny { width: 8px; height: 8px; border-width: 2px; }
.badge.score.good { color: var(--green); border-color: var(--green); }
.badge.score.mid { color: var(--accent); border-color: var(--accent); }
.badge.score.bad { color: var(--red); border-color: var(--red); }
.meta {
  display: flex;
  flex-wrap: wrap;
  column-gap: 14px;
  row-gap: 4px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}
.meta > * { white-space: nowrap; }
.meta .who {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.branch {
  font-family: var(--mono);
  max-width: 34ch;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats { font-family: var(--mono); }
.add { color: var(--green); }
.del { color: var(--red); margin-left: 6px; }
</style>
