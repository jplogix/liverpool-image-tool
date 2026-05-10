import { createReadStream, existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const distDir = resolve(__dirname, 'dist')
const port = Number(process.env.PORT ?? 3000)

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
}

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, headers)
  response.end(body)
}

async function handleImageProxy(requestUrl, response) {
  const imageUrlEncoded = requestUrl.searchParams.get('url');
  const imageUrl = imageUrlEncoded ? decodeURIComponent(imageUrlEncoded) : null;

  if (!imageUrl) {
    send(response, 400, 'Missing image URL.')
    return
  }

  let parsed
  try {
    parsed = new URL(imageUrl)
  } catch {
    send(response, 400, 'Invalid image URL.')
    return
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    send(response, 400, 'Unsupported image URL protocol.')
    return
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const upstream = await fetch(parsed, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/*,*/*',
      },
    })
    clearTimeout(timeout)

    if (!upstream.ok) {
      send(response, upstream.status, `Image request failed: ${upstream.statusText}`)
      return
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
    const body = Buffer.from(await upstream.arrayBuffer())
    send(response, 200, body, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
      'Content-Type': contentType,
    })
  } catch (error) {
    send(response, 502, error instanceof Error ? error.message : 'Image proxy failed.')
  }
}

async function serveStatic(pathname, response) {
  const requestedPath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const candidate = resolve(join(distDir, requestedPath))
  const filePath = candidate.startsWith(distDir) && existsSync(candidate) ? candidate : join(distDir, 'index.html')

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      const html = await readFile(join(distDir, 'index.html'))
      send(response, 200, html, { 'Content-Type': contentTypes['.html'] })
      return
    }

    response.writeHead(200, {
      'Content-Length': fileStat.size,
      'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
    })
    createReadStream(filePath).pipe(response)
  } catch {
    send(response, 404, 'Not found.')
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (requestUrl.pathname === '/health') {
    send(response, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' })
    return
  }

  if (requestUrl.pathname === '/image-proxy') {
    await handleImageProxy(requestUrl, response)
    return
  }

  await serveStatic(requestUrl.pathname, response)
})

server.listen(port, '0.0.0.0', () => {
  console.log(`CSV image mapping app listening on port ${port}`)
})
