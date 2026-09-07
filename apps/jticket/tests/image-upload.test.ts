import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import { decodeInlineImage, storeMediaBytes, mediaPath } from '@jsuite/documents/media'
import { decodeAttachmentPayload, attachmentMarkdown } from '../server/utils/attachments'

// The two upload paths images take into the suite:
//   tickets   → POST /api/attachments   (decodeAttachmentPayload)
//   documents → image block with inline bytes (storeMediaBytes via materialise)
// Both accept a data: URL or bare base64; attachments also take a local file.

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PNG = Buffer.from(PNG_B64, 'base64')
const DATA_DIR = process.env.JSUITE_DATA_DIR!

describe('decodeInlineImage', () => {
  it('reads a data URL and reports the extension its type implies', () => {
    const { bytes, ext } = decodeInlineImage(`data:image/png;base64,${PNG_B64}`)
    expect(bytes.equals(PNG)).toBe(true)
    expect(ext).toBe('.png')
  })

  it('reads bare base64 with no extension hint', () => {
    const { bytes, ext } = decodeInlineImage(PNG_B64)
    expect(bytes.equals(PNG)).toBe(true)
    expect(ext).toBe('')
  })

  it('refuses non-image data URLs, empty payloads and oversize images', () => {
    expect(() => decodeInlineImage(`data:application/pdf;base64,${PNG_B64}`)).toThrow(/unsupported image type/)
    expect(() => decodeInlineImage('')).toThrow(/empty/)
    expect(() => decodeInlineImage('data:image/png;base64')).toThrow(/data URL/)
    const huge = Buffer.alloc(12 * 1024 * 1024 + 1).toString('base64')
    expect(() => decodeInlineImage(huge)).toThrow(/too large/)
  })
})

describe('storeMediaBytes', () => {
  const KEY = 'image-upload-test'
  beforeEach(() => rmSync(join(DATA_DIR, 'jexplain', 'media', KEY), { recursive: true, force: true }))

  it('writes block media under the doc key and returns the served URL', async () => {
    const src = await storeMediaBytes(KEY, `data:image/png;base64,${PNG_B64}`, 'Shot 1.png')
    expect(src).toBe(`/api/media/${KEY}/shot-1.png`)
    expect(readFileSync(mediaPath(KEY, 'shot-1.png')).equals(PNG)).toBe(true)
  })

  it('lets the data URL type override the name extension, and falls back to .png for bare base64', async () => {
    expect(await storeMediaBytes(KEY, `data:image/jpeg;base64,${PNG_B64}`, 'shot.png')).toBe(`/api/media/${KEY}/shot.jpg`)
    expect(await storeMediaBytes(KEY, PNG_B64, 'shot.webp')).toBe(`/api/media/${KEY}/shot.webp`)
    expect(await storeMediaBytes(KEY, PNG_B64, 'shot')).toBe(`/api/media/${KEY}/shot.png`)
    expect(await storeMediaBytes(KEY, PNG_B64)).toBe(`/api/media/${KEY}/image.png`)
  })
})

describe('decodeAttachmentPayload', () => {
  const dir = join(DATA_DIR, 'image-upload-src')
  beforeEach(() => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
  })

  it('accepts { name, base64 } as bare base64 or a data URL, and dataUrl as a synonym', () => {
    expect(decodeAttachmentPayload({ name: 'a.png', base64: PNG_B64 })).toEqual({ name: 'a.png', buf: PNG })
    expect(decodeAttachmentPayload({ name: 'a.png', base64: `data:image/png;base64,${PNG_B64}` }).buf.equals(PNG)).toBe(true)
    expect(decodeAttachmentPayload({ name: 'a.png', dataUrl: `data:image/png;base64,${PNG_B64}` }).buf.equals(PNG)).toBe(true)
  })

  it('accepts { file } and names the attachment after the file unless told otherwise', () => {
    const file = join(dir, 'Checkout Flow.png')
    writeFileSync(file, PNG)
    expect(decodeAttachmentPayload({ file })).toEqual({ name: 'Checkout-Flow.png', buf: PNG })
    expect(decodeAttachmentPayload({ file, name: 'flow.png' }).name).toBe('flow.png')
    expect(() => decodeAttachmentPayload({ file: join(dir, 'missing.png') })).toThrow(/not found/)
    expect(existsSync(file)).toBe(true)
  })

  it('strips path components from names and rejects bodies with nothing to store', () => {
    expect(decodeAttachmentPayload({ name: '../../etc/passwd.png', base64: PNG_B64 }).name).toBe('passwd.png')
    expect(() => decodeAttachmentPayload({ base64: PNG_B64 })).toThrow(/name is required/)
    expect(() => decodeAttachmentPayload({ name: 'a.png' })).toThrow(/base64.*or file/)
    expect(() => decodeAttachmentPayload({ name: 'a.png', base64: '' })).toThrow(/base64.*or file/)
  })
})

describe('attachmentMarkdown', () => {
  it('embeds images and links everything else', () => {
    expect(attachmentMarkdown('flow.png')).toBe('![flow.png](/attachments/flow.png)')
    expect(attachmentMarkdown('brief.pdf')).toBe('[brief.pdf](/attachments/brief.pdf)')
  })
})
