import { getCloudflareContext } from '@opennextjs/cloudflare'
import { v4 as uuidv4 } from 'uuid'

export const maxDuration = 30

// Helper to parse cookies from the request
function getCookie(req: Request, name: string): string | undefined {
  const cookie = req.headers.get('cookie')
  if (!cookie) return undefined
  const match = cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : undefined
}

// Proxy all chat requests to the deployed Agent Worker endpoint
export async function POST(req: Request) {
  // Session management: get or create a secure session_id
  let sessionId = getCookie(req, 'session_id')
  let setSessionCookie = false
  if (!sessionId) {
    sessionId = uuidv4()
    setSessionCookie = true
  }

  // Get the Cloudflare context (env with service bindings)
  const { env } = getCloudflareContext()

  // Always add session_id as a query param for deterministic DO mapping
  const url = new URL(req.url)
  url.searchParams.set('session_id', sessionId)
  const proxyReq = new Request(url.toString(), {
    method: req.method,
    headers: req.headers,
    body: req.body,
  })

  // @ts-expect-error: CloudflareEnv does not have AGENT_PROXY_WORKER
  const proxyRes = await env.AGENT_PROXY_WORKER.fetch(proxyReq)

  // Prepare headers for the response
  const headers = new Headers(proxyRes.headers)

  // Set session_id cookie if it was newly generated
  if (setSessionCookie) {
    headers.append(
      'Set-Cookie',
      `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax`
    )
  }

  // Stream the response body back to the client
  return new Response(proxyRes.body, {
    status: proxyRes.status,
    headers: proxyRes.headers,
  })
}
