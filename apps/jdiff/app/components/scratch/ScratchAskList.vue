<script setup lang="ts">
import { scratchAsks } from '~/utils/scratchpadFixture'

const emit = defineEmits<{ answered: [count: number] }>()

const answers = ref(scratchAsks.map(() => ({ text: '', posted: false })))

function post(i: number) {
  const a = answers.value[i]!
  if (!a.text.trim()) return
  a.posted = true
  emit('answered', answers.value.filter((x) => x.posted).length)
}
</script>

<template>
  <ul class="ask-list">
    <li v-for="(q, i) in scratchAsks" :key="i">
      <p class="q">{{ q }}</p>
      <template v-if="!answers[i]!.posted">
        <textarea
          v-model="answers[i]!.text"
          class="answer"
          rows="2"
          :placeholder="'your answer…'"
          spellcheck="false"
        />
        <div class="row">
          <button class="post" :disabled="!answers[i]!.text.trim()" @click="post(i)">
            post answer
          </button>
        </div>
      </template>
      <p v-else class="posted">
        <span class="check">✓</span> posted to the review — “{{ answers[i]!.text }}”
      </p>
    </li>
  </ul>
</template>

<style scoped>
.ask-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.q {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.5;
}
.answer {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}
.answer:focus { border-color: var(--accent); }
.answer::placeholder { color: var(--muted); }
.row {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
.post {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  border-radius: 6px;
  padding: 3px 12px;
  cursor: pointer;
  font-size: 12px;
}
.post:hover:not(:disabled) { border-color: var(--accent); color: var(--text); }
.post:disabled { opacity: 0.5; cursor: default; }
.posted {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}
.check { color: var(--green); }
</style>
