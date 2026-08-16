<script setup lang="ts">
const routes = useDiffRoutes()

useHead({ title: 'open a repo' })

const path = ref('')
const busy = ref(false)
const error = ref('')
const recents = ref<{ path: string; slug: string }[]>([])

onMounted(() => {
  try {
    recents.value = JSON.parse(localStorage.getItem('jdiff:recents') ?? '[]')
  } catch { /* ignore */ }
})

const browsing = ref(false)

async function browse() {
  browsing.value = true
  error.value = ''
  try {
    const picked = await $fetch<{ path: string | null }>('/api/pick-folder')
    if (picked.path) {
      path.value = picked.path
      await open(picked.path)
    }
  } catch (e: any) {
    error.value = e.data?.message ?? e.message ?? 'folder picker failed'
  } finally {
    browsing.value = false
  }
}

async function open(target?: string) {
  const repo = (target ?? path.value).trim()
  if (!repo) return
  busy.value = true
  error.value = ''
  try {
    const info = await $fetch<{ path: string; slug: string }>('/api/repo', { query: { repo } })
    const next = [{ path: info.path, slug: info.slug }, ...recents.value.filter((r) => r.path !== info.path)].slice(0, 10)
    localStorage.setItem('jdiff:recents', JSON.stringify(next))
    navigateTo(routes.prs(info.path))
  } catch (e: any) {
    error.value = e.data?.message ?? e.message ?? 'failed to open repo'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="diff-surface home">
    <h1>{{ routes.brand }}</h1>
    <p class="sub">point at a local clone; PRs come from github, diffs come from your git</p>

    <form class="picker" @submit.prevent="open()">
      <input
        v-model="path"
        placeholder="~/code/my-repo"
        spellcheck="false"
        autofocus
      >
      <button type="button" :disabled="busy || browsing" @click="browse()">
        <span v-if="!browsing">browse…</span>
        <span v-else class="spinner" />
      </button>
      <button type="submit" :disabled="busy || browsing">
        <span v-if="!busy">open</span>
        <span v-else class="spinner" />
      </button>
    </form>

    <div v-if="error" class="error-box">{{ error }}</div>

    <div v-if="recents.length" class="recents">
      <h2>recent</h2>
      <button v-for="r in recents" :key="r.path" class="recent" @click="open(r.path)">
        <span class="slug">{{ r.slug }}</span>
        <span class="rpath">{{ r.path }}</span>
      </button>
    </div>

    <section class="about">
      <h2>how it works</h2>
      <ol class="steps">
        <li>point it at a local clone — nothing gets cloned, it uses the checkout you already have</li>
        <li><code>gh</code> asks github which PRs are open (log in once with <code>gh auth login</code>)</li>
        <li><code>git</code> fetches the PR head into your clone and diffs it against the merge-base — no github diff api, highlighted locally</li>
      </ol>

      <div class="feature">
        <h3>the diff</h3>
        <p>
          side-by-side, syntax highlighted, computed by your own git. expand context around any hunk,
          close files you're done with, and read github comment threads inline — or ask claude about
          any line without leaving the diff.
        </p>
        <div class="demo demo-diff" aria-hidden="true">
          <div class="dgrid">
            <span class="num">41</span><span class="code">if (!cache.has(key)) {</span>
            <span class="num">41</span><span class="code">if (!cache.has(key)) {</span>
            <span class="num del-num">42</span><span class="code del">&nbsp;&nbsp;return fetchDiff(repo)</span>
            <span class="num add-num">42</span><span class="code add">&nbsp;&nbsp;return cached(repo, key)</span>
            <span class="num">43</span><span class="code">}</span>
            <span class="num">43</span><span class="code">}</span>
          </div>
        </div>
      </div>

      <h2>the guidance layer</h2>
      <p class="lede">
        one claude run per PR writes four review aids against the diff. they read like a colleague's
        walkthrough, not a verdict — consult them or ignore them. everything is saved locally in
        <code>~/.jdiff</code> and marked stale when new commits land.
      </p>

      <div class="feature">
        <h3>guided tour</h3>
        <p>
          an overview of the change plus ordered stops through the diff. the tour bar walks you stop
          to stop, scrolling and highlighting each one in place — commenting and context expansion
          keep working mid-tour, and your position survives a reload.
        </p>
        <div class="demo demo-tour" aria-hidden="true">
          <span class="tstep">2/7</span>
          <span class="tnote">the cache key now includes the base sha — this is what invalidates the old entries</span>
          <span class="tbtn quiet">prev</span>
          <span class="tbtn primary">next</span>
        </div>
      </div>

      <div class="feature">
        <h3>risk heatmap</h3>
        <p>
          every file in the diff rated low / medium / high with a reason, and a matching dot next to
          each file in the sidebar — so you know where to slow down before you start scrolling.
        </p>
        <div class="demo demo-risk" aria-hidden="true">
          <div class="rrow"><span class="dot high" /><span class="rpath2">server/api/diff.get.ts</span><span class="rwhy">rewrites cache invalidation</span></div>
          <div class="rrow"><span class="dot med" /><span class="rpath2">app/composables/useDiffAiTasks.ts</span><span class="rwhy">new reconnect logic</span></div>
          <div class="rrow"><span class="dot low" /><span class="rpath2">README.md</span><span class="rwhy">docs only</span></div>
        </div>
      </div>

      <div class="feature">
        <h3>review rating</h3>
        <p>
          how reviewable the change is: a score, the effort it'll take, what helps and hurts, and a
          suggested reading order that links straight into the diff.
        </p>
        <div class="demo demo-rating" aria-hidden="true">
          <span class="score">7/10</span>
          <span class="rsum">an afternoon read — start with the server half, the ui follows from it</span>
        </div>
      </div>

      <div class="feature">
        <h3>ask yourself</h3>
        <p>
          three big-picture questions — architecture, new patterns, hard-to-reverse decisions — that
          you answer in your own words. answers save as drafts and can be posted back to the PR as
          regular comments.
        </p>
        <div class="demo demo-self" aria-hidden="true">
          <p class="q">this adds a second cache layer — who invalidates it, and what happens when the two disagree?</p>
          <span class="ans">your answer…</span>
        </div>
      </div>

      <div class="feature">
        <h3>also in the room</h3>
        <p class="plain">
          a file map of the changed files linked by imports, inline comment threads posted straight
          to github, and per-line claude asks saved alongside the PR.
        </p>
      </div>
    </section>

    <DiffScrollTopButton />
  </main>
</template>

<style scoped>
.home {
  max-width: 640px;
  margin: 12vh auto 0;
  padding: 0 24px;
}
h1 {
  font-family: var(--mono);
  font-size: 28px;
  margin: 0 0 4px;
}
.sub {
  color: var(--muted);
  margin: 0 0 28px;
}
.picker {
  display: flex;
  gap: 8px;
}
.picker input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  font-family: var(--mono);
  font-size: 13px;
  outline: none;
}
.picker input:focus { border-color: var(--accent); }
.picker button {
  padding: 10px 20px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  cursor: pointer;
  display: flex;
  align-items: center;
}
.picker button:hover { border-color: var(--accent); }
.recents { margin-top: 36px; }
.recents h2 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin: 0 0 8px;
}
.recent {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  padding: 10px 14px;
  margin-bottom: 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  cursor: pointer;
  text-align: left;
}
.recent:hover { border-color: var(--accent); }
.recent .slug { font-weight: 600; }

/* about / how it works */
.about {
  margin-top: 56px;
  padding-bottom: 12vh;
}
.about h2 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin: 40px 0 12px;
}
.about h2:first-child { margin-top: 0; }
.about code {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 4px;
}
.steps {
  margin: 0;
  padding-left: 20px;
  font-size: 14px;
  line-height: 1.5;
}
.steps li { margin-bottom: 6px; }
.steps li::marker {
  font-family: var(--mono);
  color: var(--muted);
}
.lede {
  font-size: 14px;
  line-height: 1.5;
  margin: 0 0 20px;
}
.feature { margin: 20px 0 24px; }
.feature h3 {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  margin: 0 0 4px;
}
.feature p {
  font-size: 14px;
  line-height: 1.5;
  margin: 0 0 10px;
}
.feature .plain { margin-bottom: 0; }

/* previews: static mocks, carved like the real thing */
.demo {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  overflow: hidden;
}
.demo-diff { padding: 6px 0; }
.dgrid {
  display: grid;
  grid-template-columns: minmax(36px, auto) 1fr minmax(36px, auto) 1fr;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 20px;
}
.dgrid .num {
  color: var(--muted);
  text-align: right;
  padding: 0 8px;
  user-select: none;
}
.dgrid .code { padding: 0 10px; white-space: pre; overflow: hidden; }
.dgrid .del { background: var(--del-bg); }
.dgrid .del-num { background: var(--del-num-bg); color: var(--text); }
.dgrid .add { background: var(--add-bg); }
.dgrid .add-num { background: var(--add-num-bg); color: var(--text); }

.demo-tour {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-color: var(--accent);
  border-radius: 10px;
}
.tstep {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--accent);
  flex-shrink: 0;
}
.tnote {
  font-size: 14px;
  flex: 1;
  min-width: 0;
}
.tbtn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 5px;
  border: 1px solid var(--border);
  color: var(--muted);
  flex-shrink: 0;
}
.tbtn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
}

.demo-risk { padding: 6px 12px; }
.rrow {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  align-self: center;
}
.dot.high { background: var(--red); }
.dot.med { background: #d29922; }
.dot.low { background: var(--green); }
.rpath2 {
  font-family: var(--mono);
  font-size: 12px;
}
.rwhy {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.demo-rating {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
}
.score {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--green);
  border: 1px solid var(--green);
  border-radius: 10px;
  padding: 1px 8px;
  flex-shrink: 0;
}
.rsum { font-size: 14px; }

.demo-self { padding: 10px 12px; }
.demo-self .q {
  font-size: 14px;
  line-height: 1.5;
  margin: 0 0 8px;
}
.demo-self .ans {
  display: block;
  font-size: 11px;
  color: var(--muted);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
}
.recent .rpath {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
