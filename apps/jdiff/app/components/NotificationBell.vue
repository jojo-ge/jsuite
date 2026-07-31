<script setup lang="ts">
import type { AppNotification } from '~/composables/useNotifications'

const props = defineProps<{ repo: string }>()

const { notifications, unreadCount, isUnread, markAllRead, refresh } = useNotifications(
  toRef(props, 'repo'),
)

const open = ref(false)
const root = ref<HTMLElement>()

function toggle() {
  open.value = !open.value
  if (open.value) refresh()
  else markAllRead()
}

function close() {
  if (!open.value) return
  open.value = false
  markAllRead()
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) close()
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

function labelFor(n: AppNotification): string {
  if (n.type === 'pr_opened') return `${n.actor} opened PR #${n.prNumber}`
  if (n.type === 'reaction') return `${n.emoji} on your comment · #${n.prNumber}`
  if (n.reason === 'reply') return `${n.actor} replied in a thread · #${n.prNumber}`
  return `${n.actor} commented on your PR #${n.prNumber}`
}

function go(n: AppNotification) {
  close()
  navigateTo({ path: `/pr/${n.prNumber}`, query: { repo: props.repo } })
}
</script>

<template>
  <div ref="root" class="notif">
    <button class="bell" :class="{ open }" title="notifications" @click="toggle()">
      🔔
      <span v-if="unreadCount" class="count">{{ unreadCount }}</span>
    </button>

    <div v-if="open" class="panel">
      <div class="panel-head">
        <span>notifications</span>
        <button v-if="unreadCount" class="clear" @click="markAllRead()">mark all read</button>
      </div>
      <div v-if="!notifications.length" class="empty">you're all caught up</div>
      <ul v-else class="items">
        <li v-for="n in notifications" :key="n.id">
          <button class="item" :class="{ unread: isUnread(n) }" @click="go(n)">
            <span class="icon">
              {{ n.type === 'pr_opened' ? '🆕' : n.type === 'reaction' ? n.emoji : '💬' }}
            </span>
            <span class="body">
              <span class="label">{{ labelFor(n) }}</span>
              <span v-if="n.prTitle && n.type === 'pr_opened'" class="detail">{{ n.prTitle }}</span>
              <span v-else-if="n.excerpt" class="detail">{{ n.excerpt }}</span>
              <span class="when">{{ timeAgo(n.createdAt) }}</span>
            </span>
            <span v-if="isUnread(n)" class="dot" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.notif { position: relative; }
.bell {
  position: relative;
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 13px;
}
.bell:hover, .bell.open { border-color: var(--accent); }
.count {
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--bg);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}
.panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: 380px;
  max-height: 60vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 20;
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  font-size: 12px;
  color: var(--muted);
  position: sticky;
  top: 0;
  background: var(--panel);
}
.clear {
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.clear:hover { text-decoration: underline; }
.empty {
  padding: 24px 14px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.items {
  list-style: none;
  margin: 0;
  padding: 0;
}
.items li + li { border-top: 1px solid var(--border); }
.item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
}
.item:hover { background: var(--panel-2); }
.icon { font-size: 14px; line-height: 1.4; }
.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.label { font-size: 13px; }
.item.unread .label { font-weight: 600; }
.detail {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.when { font-size: 11px; color: var(--muted); }
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  margin-top: 6px;
  flex-shrink: 0;
}
</style>
