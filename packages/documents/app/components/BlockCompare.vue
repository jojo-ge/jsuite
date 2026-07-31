<script setup lang="ts">
import type { CompareBlock } from '../../types'

const props = defineProps<{ block: CompareBlock }>()
const { render } = useMarkdown()
</script>

<template>
  <figure>
    <h3 v-if="block.title" class="mb-3 text-lg font-semibold">{{ block.title }}</h3>
    <div class="overflow-x-auto rounded-xl border border-default">
      <table class="w-full border-collapse text-[15px]">
        <thead>
          <tr class="border-b border-default bg-elevated/60">
            <th
              v-for="(col, i) in props.block.columns"
              :key="i"
              class="px-4 py-2.5 text-left text-[13px] font-semibold uppercase tracking-wide text-muted"
            >
              {{ col }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, r) in props.block.rows" :key="r" class="border-b border-default last:border-b-0">
            <td
              v-for="(cell, c) in row"
              :key="c"
              class="px-4 py-2.5 align-top"
              :class="c === 0 ? 'font-medium' : ''"
            >
              <div class="jx-prose jx-prose-sm" v-html="render(cell)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </figure>
</template>
