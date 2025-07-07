/* eslint-disable @typescript-eslint/no-explicit-any */
import { getAgentByName } from 'agents'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { OrchestrApiAgent } from './agent-class'

export { OrchestrApiAgent }
// eslint-disable-next-line import/no-anonymous-default-export
export default class extends WorkerEntrypoint {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      const sessionId = url.searchParams.get('session_id') || ''

      const agent = await getAgentByName(
        (this.env as any).OrchestrApiAgent,
        sessionId
      )

      return agent.fetch(request)
    }

    return new Response('No agent here', { status: 404 })
  }

  async testEcho(data: unknown) {
    return { ok: true, echo: data, message: 'Agent ProxyWorker is reachable!' }
  }
}
