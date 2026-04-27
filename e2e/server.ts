import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'

const pages: Record<string, string> = {
  '/': `<!DOCTYPE html>
<html lang="en">
<head><title>Test Home</title></head>
<body>
  <h1>Home Page</h1>
  <p>This is the home page for testing translation.</p>
  <a href="/page2" id="link-page2">Go to Page 2</a>
</body>
</html>`,
  '/page2': `<!DOCTYPE html>
<html lang="en">
<head><title>Test Page 2</title></head>
<body>
  <h1>Second Page</h1>
  <p>This is the second page with different content for testing.</p>
  <a href="/" id="link-home">Back to Home</a>
</body>
</html>`,
  '/page3': `<!DOCTYPE html>
<html lang="en">
<head><title>Test Page 3</title></head>
<body>
  <h1>Third Page</h1>
  <p>Yet another page to verify navigation behavior.</p>
</body>
</html>`,
  '/dynamic-text': `<!DOCTYPE html>
<html lang="en">
<head><title>Dynamic Text</title></head>
<body>
  <div id="tweet">
    <span id="tweet-text">This is a truncated message</span>
  </div>
  <button id="show-more">Show more</button>
  <script>
    document.getElementById('show-more').addEventListener('click', function() {
      var span = document.getElementById('tweet-text');
      var textNode = span.firstChild;
      if (textNode && textNode.nodeType === 3) {
        textNode.textContent = textNode.textContent + ' that continues with much more content after expanding';
      }
    });
  </script>
</body>
</html>`,
  '/inner-scroll': `<!DOCTYPE html>
<html lang="en">
<head><title>Inner Scroll</title></head>
<body style="margin:0;overflow:hidden">
  <div id="scroll-container" style="height:200px;overflow-y:auto">
    <p>Visible message one</p>
    <p>Visible message two</p>
    <p>Visible message three</p>
    <div style="height:3000px"></div>
    <p id="bottom-msg">Hidden message at bottom</p>
  </div>
</body>
</html>`,
}

const app = new Hono()

app.use('/v1/*', cors())

app.post('/v1/chat/completions', async (c) => {
  const data = await c.req.json()
  const userMsg: string = data.messages?.find((m: any) => m.role === 'user')?.content ?? ''
  const tagRegex = /<t id="(\d+)">([\s\S]*?)<\/t>/g
  let translated = ''
  let match
  while ((match = tagRegex.exec(userMsg)) !== null) {
    translated += `<t id="${match[1]}">[翻译] ${match[2]}</t>\n`
  }
  return c.json({
    choices: [{
      message: { role: 'assistant', content: translated.trim() },
    }],
  })
})

app.get('/:path{.*}', (c) => {
  const html = pages[`/${c.req.param('path') ?? ''}`] ?? pages[c.req.path]
  if (html) return c.html(html)
  return c.notFound()
})

export function createTestServer(): { start(): Promise<string>; stop(): Promise<void> } {
  let server: ReturnType<typeof serve> | null = null

  return {
    async start() {
      return new Promise<string>((resolve) => {
        server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
          resolve(`http://127.0.0.1:${info.port}`)
        })
      })
    },
    async stop() {
      if (server) server.close()
    },
  }
}
