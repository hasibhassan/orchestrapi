import { Agent } from 'agents'
import { streamText } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'

interface Env {
  AI: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export class OrchestrApiAgent extends Agent<Env> {
  async fetch(request: Request): Promise<Response> {
    return this.onRequest(request)
  }

  async onRequest(request: Request): Promise<Response> {
    let body: Record<string, unknown> = {}

    if (request.method === 'POST') {
      try {
        body = await request.json()
      } catch (e) {
        console.error('Failed to parse JSON body:', e)
        return new Response('Invalid JSON', { status: 400 })
      }
    }
    const { messages, system, tools } = body

    const workersai = createWorkersAI({ binding: this.env.AI })
    const model = workersai('@cf/meta/llama-3.1-8b-instruct')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args: any = {
      model,
      toolCallStreaming: true,
      onError: console.log,
    }
    if (Array.isArray(messages)) args.messages = messages
    if (typeof system === 'string') args.system = system
    if (tools && typeof tools === 'object' && Object.keys(tools).length > 0) {
      args.tools = tools as Record<string, unknown>
    }

    const result = streamText(args)

    return result.toDataStreamResponse({
      headers: {
        // add these headers to ensure that the
        // response is chunked and streamed
        'Content-Type': 'text/x-unknown',
        'content-encoding': 'identity',
        'transfer-encoding': 'chunked',
      },
    })
  }
}
