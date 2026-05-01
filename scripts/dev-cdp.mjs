#!/usr/bin/env node
// Drive the dev-mode `__imp` hook in the extension's service worker via CDP.
// Requires `pnpm dev` to be running (Chrome on port 9222 with extension loaded).
//
// Usage:
//   node scripts/dev-cdp.mjs eval "<js-expression>"   # run expression in SW
//   node scripts/dev-cdp.mjs open <url>               # open a new tab

const HOST = '127.0.0.1'
const PORT = 9222

const [, , cmd, ...rest] = process.argv
const arg = rest.join(' ')

const usage = `usage:
  dev-cdp.mjs eval "<js-expression>"
  dev-cdp.mjs open <url>`

if (!cmd) {
  console.error(usage)
  process.exit(2)
}

const getJSON = async (path) => (await fetch(`http://${HOST}:${PORT}${path}`)).json()

function client(url) {
  const ws = new WebSocket(url)
  let nextId = 1
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result)
    }
  }
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error(`failed to connect to ${url}`))
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ws, ready, send }
}

async function findSW() {
  const targets = await getJSON('/json/list')
  const sw = targets.find(
    (t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'),
  )
  if (!sw) throw new Error('no extension service-worker target. Is `pnpm dev` running?')
  return sw
}

async function main() {
  if (cmd === 'open') {
    if (!arg) throw new Error('open requires a URL')
    const c = client((await getJSON('/json/version')).webSocketDebuggerUrl)
    await c.ready
    const { targetId } = await c.send('Target.createTarget', { url: arg })
    console.log(targetId)
    c.ws.close()
    return
  }

  if (cmd === 'eval') {
    if (!arg) throw new Error('eval requires an expression')
    const sw = await findSW()
    const c = client(sw.webSocketDebuggerUrl)
    await c.ready
    await c.send('Runtime.enable')
    const r = await c.send('Runtime.evaluate', {
      expression: `(async () => await (${arg}))()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      console.error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      process.exit(1)
    }
    console.log(JSON.stringify(r.result.value, null, 2))
    c.ws.close()
    return
  }

  console.error(`unknown command: ${cmd}\n${usage}`)
  process.exit(2)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
