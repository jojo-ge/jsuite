import type { Ref } from 'vue'

// Image upload for the markdown fields — ticket description, resolution and
// comments. A paste, a drop or the picker sends the bytes to POST
// /api/attachments and inserts `![name](/attachments/<name>)` at the caret,
// so the field's value stays plain GFM: nothing about the ticket changes
// shape, and the API-authored path (skills uploading the same way) renders
// identically. Names get a time prefix because the endpoint overwrites on a
// collision — two "Screenshot.png" pastes must not clobber each other.

export interface UploadedAttachment {
  name: string
  url: string
  size: number
  markdown: string
}

export const isImageFile = (f: File) => f.type.startsWith('image/')
const isImage = isImageFile

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('could not read file'))
    reader.readAsDataURL(file)
  })
}

function uniqueName(file: File): string {
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? `.${file.type.split('/')[1] || 'png'}`).toLowerCase()
  const stem = (file.name.replace(/\.[a-z0-9]+$/i, '') || 'image')
    .toLowerCase()
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${Date.now().toString(36)}-${stem || 'image'}${ext}`
}

/** Upload one image to the attachments store; returns its served URL + markdown. */
export async function uploadAttachment(file: File): Promise<UploadedAttachment> {
  const dataUrl = await readAsDataUrl(file)
  return await $fetch<UploadedAttachment>('/api/attachments', {
    method: 'POST',
    body: { name: uniqueName(file), base64: dataUrl },
  })
}

/**
 * Splice `text` into `model` at the textarea's caret (or append when the
 * caret isn't known), padded onto its own line so the image renders as a
 * block rather than inline in a sentence.
 */
function insertAtCaret(model: Ref<string>, text: string, target?: HTMLTextAreaElement | null) {
  const value = model.value ?? ''
  const at = target && typeof target.selectionStart === 'number' ? target.selectionStart : value.length
  const before = value.slice(0, at)
  const after = value.slice(target && typeof target.selectionEnd === 'number' ? target.selectionEnd : at)
  const lead = before && !before.endsWith('\n') ? (before.endsWith('\n\n') ? '' : '\n') : ''
  const trail = after && !after.startsWith('\n') ? '\n' : ''
  const next = before + lead + text + trail + after
  model.value = next
  if (target) {
    // Put the caret after what we inserted once Vue has written the value back.
    const caret = (before + lead + text + trail).length
    requestAnimationFrame(() => target.setSelectionRange(caret, caret))
  }
}

export function useAttachImages(model: Ref<string>) {
  const uploading = ref(0)
  const error = ref('')

  async function attach(files: File[], target?: HTMLTextAreaElement | null) {
    const images = files.filter(isImage)
    if (!images.length) return
    error.value = ''
    uploading.value += images.length
    try {
      for (const file of images) {
        const up = await uploadAttachment(file)
        insertAtCaret(model, up.markdown, target)
      }
    } catch (err) {
      error.value = (err as { data?: { statusMessage?: string }; message?: string }).data?.statusMessage
        ?? (err as Error).message
        ?? 'upload failed'
    } finally {
      uploading.value -= images.length
    }
  }

  /** Paste handler: image files upload; plain text pastes fall through untouched. */
  function onPaste(e: ClipboardEvent) {
    const files = Array.from(e.clipboardData?.files ?? []).filter(isImage)
    if (!files.length) return
    e.preventDefault()
    void attach(files, e.target as HTMLTextAreaElement)
  }

  function onDrop(e: DragEvent) {
    const files = Array.from(e.dataTransfer?.files ?? []).filter(isImage)
    if (!files.length) return
    e.preventDefault()
    void attach(files, e.target as HTMLTextAreaElement)
  }

  /** Open the file picker (the button next to the field). */
  function pick(target?: HTMLTextAreaElement | null) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => void attach(Array.from(input.files ?? []), target)
    input.click()
  }

  return { uploading, error, attach, onPaste, onDrop, pick }
}
