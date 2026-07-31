// Claude is asked to respond with ONLY a JSON object, but occasionally wraps
// it in prose or fences, or leaves a quote / newline unescaped inside a
// string value. Pull out the first balanced object and repair those cases
// before giving up.
export function extractJson(text: string): any {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw createError({ statusCode: 500, message: 'claude returned no JSON: ' + text.slice(0, 200) })
  }
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch (err: any) {
    try {
      return JSON.parse(repair(text.slice(start)))
    } catch {
      throw createError({
        statusCode: 500,
        message: `claude returned invalid JSON (${err.message}): ${text.slice(start, start + 200)}`,
      })
    }
  }
}

// Walks from the opening brace tracking string state: escapes raw control
// characters inside strings, escapes interior double quotes that cannot
// legally end the string, and stops at the balanced closing brace so
// trailing prose is dropped.
function repair(text: string): string {
  let out = ''
  let inString = false
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (!inString) {
      if (c === '"') {
        inString = true
      } else if (c === '{' || c === '[') {
        depth++
      } else if (c === '}' || c === ']') {
        depth--
      }
      out += c
      if (depth === 0) break
      continue
    }
    if (c === '\\') {
      out += c + (text[i + 1] ?? '')
      i++
    } else if (c === '\n') {
      out += '\\n'
    } else if (c === '\r') {
      out += '\\r'
    } else if (c === '\t') {
      out += '\\t'
    } else if (c === '"') {
      if (closesString(text, i + 1)) {
        inString = false
        out += c
      } else {
        out += '\\"'
      }
    } else {
      out += c
    }
  }
  return out
}

// A quote ends a string only when what follows can legally continue the
// JSON: a key's colon, a closing bracket, or a comma leading into the next
// key or element.
function closesString(text: string, i: number): boolean {
  while (i < text.length && ' \n\r\t'.includes(text[i]!)) i++
  const c = text[i]
  if (c === undefined || c === ':' || c === '}' || c === ']') return true
  if (c !== ',') return false
  let j = i + 1
  while (j < text.length && ' \n\r\t'.includes(text[j]!)) j++
  const n = text[j]
  return n === '"' || n === '{' || n === '['
}
