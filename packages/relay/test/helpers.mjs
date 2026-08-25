// Shared plumbing for driving the relay from tests with plain HTTP and
// Node's built-in WebSocket client.

export async function createRoom(relay, body, headers = {}) {
  return fetch(new URL('/rooms', relay.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

export function joinUrl(relay, roomId, secret) {
  const url = new URL(`/rooms/${roomId}/ws`, relay.url)
  url.protocol = 'ws:'
  if (secret !== undefined) url.searchParams.set('secret', secret)
  return url
}

/** Open a socket into a room and wait for the connection to be established. */
export async function join(relay, roomId, secret) {
  const ws = new WebSocket(joinUrl(relay, roomId, secret))
  await opened(ws)
  return ws
}

export function opened(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(ws), { once: true })
    ws.addEventListener('error', () => reject(new Error('socket failed to open')), { once: true })
  })
}

/** Resolves with the socket's close event ({ code, reason }). */
export function closed(ws) {
  return new Promise((resolve) => {
    ws.addEventListener('close', (event) => resolve(event), { once: true })
  })
}

export function nextMessage(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), timeoutMs)
    ws.addEventListener(
      'message',
      (event) => {
        clearTimeout(timer)
        resolve(event.data)
      },
      { once: true },
    )
  })
}

/** Asserts nothing arrives on the socket within the window. */
export function expectSilence(ws, windowMs = 300) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, windowMs)
    ws.addEventListener(
      'message',
      (event) => {
        clearTimeout(timer)
        reject(new Error(`expected silence but received: ${event.data}`))
      },
      { once: true },
    )
  })
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
