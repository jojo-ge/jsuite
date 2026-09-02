<script setup lang="ts">
interface BranchInfo {
  name: string
  oid: string
  subject: string
  committedAt: string
  isCurrent: boolean
  isDefault: boolean
}

const route = useRoute()
const repo = computed(() => String(route.query.repo ?? ''))

const { data: info } = useFetch<{ slug: string }>('/api/repo', { query: { repo } })
useHead(() => ({ title: info.value?.slug ? `${info.value.slug} — branches` : 'branches' }))
const { data, pending, error, refresh } = useFetch<{
  branches: BranchInfo[]
  current: string
  defaultBranch: string
}>('/api/branches', { query: { repo } })

const defaultBranch = computed(() => data.value?.defaultBranch ?? '')
// Reviewing the default branch against itself is an empty diff; hide it from
// the pick list but keep everything else, newest commit first. The exception
// is when the default branch is the one checked out — then its uncommitted
// work is reviewable even though its committed diff is empty.
const branches = computed(() =>
  (data.value?.branches ?? []).filter((b) => !b.isDefault || b.isCurrent))

// Only the checked-out branch has an index and a working tree to look at.
const SCOPE_LINKS = ['staged', 'unstaged', 'everything'] as const

function linkTo(b: BranchInfo, scope?: string) {
  // A committed diff of the default branch against itself is empty, so send
  // that row straight at its uncommitted work instead.
  const s = scope ?? (b.isDefault ? 'everything' : undefined)
  return {
    path: '/branch',
    query: { repo: repo.value, branch: b.name, base: defaultBranch.value, ...(s ? { scope: s } : {}) },
  }
}
</script>

<template>
  <main class="branches">
    <header class="bar">
      <NuxtLink to="/" class="brand">jDiff</NuxtLink>
      <span class="slug">{{ info?.slug ?? repo }}</span>
      <NuxtLink :to="{ path: '/prs', query: { repo } }" class="tab">pull requests</NuxtLink>
      <span class="tab on">local branches</span>
      <button class="refresh" :disabled="pending" @click="refresh()">↻</button>
    </header>

    <p class="lede">
      review a local branch against <code>{{ defaultBranch || 'the default branch' }}</code> before
      it's ever pushed — comment as you go, then open the PR with every comment attached.
      On the checked-out branch you can also read the staged or unstaged changes on their own.
    </p>

    <div v-if="pending" class="center"><span class="spinner" /></div>
    <div v-else-if="error" class="error-box">{{ error.data?.message ?? error.message }}</div>
    <div v-else-if="!branches.length" class="center muted">no local branches other than {{ defaultBranch }}</div>

    <ul v-else class="list">
      <li v-for="b in branches" :key="b.name">
        <NuxtLink :to="linkTo(b)" class="branch-row">
          <div class="top">
            <span class="name">{{ b.name }}</span>
            <span v-if="b.isCurrent" class="badge current">checked out</span>
            <span class="arrow">→ {{ b.isDefault ? 'working tree' : defaultBranch }}</span>
          </div>
          <div class="meta">
            <span class="subject">{{ b.subject }}</span>
            <span class="when">{{ timeAgo(b.committedAt) }}</span>
          </div>
        </NuxtLink>
        <div v-if="b.isCurrent" class="scope-links">
          <span class="scope-lede">uncommitted:</span>
          <NuxtLink v-for="s in SCOPE_LINKS" :key="s" :to="linkTo(b, s)" class="scope-link">{{ s }}</NuxtLink>
        </div>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.branches {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px;
}
.bar {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
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
.lede {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
  margin: 0 0 16px;
}
.lede code {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 4px;
}
.center { display: flex; justify-content: center; padding: 60px 0; }
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
.branch-row {
  display: block;
  padding: 12px 16px;
  color: var(--text);
  background: var(--panel);
}
.branch-row:hover { background: var(--panel-2); text-decoration: none; }
.top { display: flex; align-items: baseline; gap: 8px; }
.name { font-family: var(--mono); font-weight: 600; }
.arrow { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--muted);
}
.badge.current { color: var(--accent); border-color: var(--accent); }
/* Straight-to-scope shortcuts, offered only on the checked-out branch. */
.scope-links {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 6px 14px 0; font-family: var(--mono); font-size: 11px;
}
.scope-lede { color: var(--muted); }
.scope-link {
  color: var(--muted); border: 1px solid var(--border); background: var(--panel-2);
  border-radius: 4px; padding: 1px 8px; text-decoration: none;
}
.scope-link:hover { color: var(--text); border-color: var(--accent); text-decoration: none; }
.scope-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.meta {
  display: flex;
  gap: 14px;
  align-items: baseline;
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}
.subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60ch;
}
.when { margin-left: auto; white-space: nowrap; }
</style>
