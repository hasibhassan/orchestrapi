import { Agent } from 'agents'
import type { Message as VercelMessage } from 'ai'
import { streamText } from 'ai'
import { createAutoRAG } from 'workers-ai-provider'

interface Env {
  AI: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

// Durable Object storage schema types
export interface ConversationTurn {
  id: string // unique per turn (e.g. nanoid or timestamp)
  role: 'user' | 'assistant' | 'tool'
  content: unknown // message content, tool call, or result
  timestamp: number
  trace?: ReasoningTrace
}

export interface ReasoningTrace {
  ragChunks?: Array<{ id: string; text: string; score: number }>
  toolCalls?: Array<{ name: string; args: unknown; result?: unknown }>
  modelSteps?: string[]
}

export interface ThreadMetadata {
  threadId: string
  title: string
  lastUpdated: number
}

// SQL row types for Agent storage
interface HistoryRow {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'tool'
  content: string // JSON stringified
  timestamp: number
  trace?: string // JSON stringified
}

interface ThreadRow {
  threadId: string
  title: string
  lastUpdated: number
}

export class OrchestrApiAgent extends Agent<Env> {
  private _tablesCreated = false

  // Ensure tables exist (run once per Agent instance)
  async onStart() {
    await this.sql`CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      threadId TEXT,
      role TEXT,
      content TEXT,
      timestamp INTEGER,
      trace TEXT
    )`
    await this.sql`CREATE TABLE IF NOT EXISTS threads (
      threadId TEXT PRIMARY KEY,
      title TEXT,
      lastUpdated INTEGER
    )`
  }

  // Insert a conversation turn
  async insertTurn(turn: Omit<HistoryRow, 'id'> & { id?: string }) {
    const id = turn.id || crypto.randomUUID()
    await this
      .sql`INSERT INTO history (id, threadId, role, content, timestamp, trace)
      VALUES (${id}, ${turn.threadId}, ${turn.role}, ${JSON.stringify(
      turn.content
    )}, ${turn.timestamp}, ${turn.trace ? JSON.stringify(turn.trace) : null})`
  }

  // Get all turns for a thread
  async getConversation(threadId: string): Promise<HistoryRow[]> {
    return await this
      .sql<HistoryRow>`SELECT * FROM history WHERE threadId = ${threadId} ORDER BY timestamp ASC`
  }

  // Insert or update thread metadata
  async upsertThread(thread: ThreadRow) {
    await this.sql`INSERT OR REPLACE INTO threads (threadId, title, lastUpdated)
      VALUES (${thread.threadId}, ${thread.title}, ${thread.lastUpdated})`
  }

  // Get thread metadata
  async getThread(threadId: string): Promise<ThreadRow | undefined> {
    const rows = await this
      .sql<ThreadRow>`SELECT * FROM threads WHERE threadId = ${threadId} LIMIT 1`
    return rows[0]
  }

  // List all threads
  async listThreads(): Promise<ThreadRow[]> {
    return await this
      .sql<ThreadRow>`SELECT * FROM threads ORDER BY lastUpdated DESC`
  }

  /**
   * Extracts the latest user message text from the assistant-ui request body.
   * Returns { threadId, lastUserMessage, fullUserMessage } or throws Response on error.
   */
  private extractUserMessage(body: Record<string, unknown>): {
    threadId: string
    lastUserMessage: string
    fullUserMessage: { role: string; content: unknown[] } | undefined
  } {
    const threadId =
      typeof body.threadId === 'string' ? body.threadId : 'default'
    const messages = Array.isArray(body.messages) ? body.messages : []
    let lastUserMessage: string | undefined = undefined
    let fullUserMessage: { role: string; content: unknown[] } | undefined =
      undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m && m.role === 'user' && Array.isArray(m.content)) {
        const textPart = m.content.find(
          (c: unknown): c is { type: string; text: string } => {
            if (typeof c === 'object' && c !== null) {
              const obj = c as Record<string, unknown>
              return obj.type === 'text' && typeof obj.text === 'string'
            }
            return false
          }
        )
        if (textPart && typeof textPart.text === 'string') {
          lastUserMessage = textPart.text
          fullUserMessage = m as { role: string; content: unknown[] }
          break
        }
      }
    }
    if (!lastUserMessage || !lastUserMessage.trim()) {
      throw new Response('Missing or invalid message', { status: 400 })
    }
    return { threadId, lastUserMessage, fullUserMessage }
  }

  async onRequest(request: Request): Promise<Response> {
    console.log('Agent: Received request')
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    try {
      const body: Record<string, unknown> = await request.json()
      // Map assistant-ui messages to Vercel AI SDK format
      type AssistantUIMsg = {
        role: string
        content: Array<{ type: string; text: string }>
      }
      const allowedRoles = ['user', 'assistant', 'system']
      const messages: Omit<VercelMessage, 'id'>[] = Array.isArray(body.messages)
        ? (body.messages as AssistantUIMsg[])
            .filter((m) => allowedRoles.includes(m.role))
            .map((m) => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content
                .filter((c) => c.type === 'text')
                .map((c) => c.text)
                .join('\n'),
            }))
        : []
      // Use streamText to get a streaming response
      const autorag = createAutoRAG({
        binding: this.env.AI.autorag('orchestrapi-rag'),
      })
      const textStream = await streamText({
        model: autorag({ model: '@cf/meta/llama-3.3-70b-instruct-sd' }),
        messages,
      })
      // Return the streaming response with proper headers
      return textStream.toTextStreamResponse({
        headers: {
          'Content-Type': 'text/x-unknown',
          'content-encoding': 'identity',
          'transfer-encoding': 'chunked',
        },
      })
    } catch (e) {
      console.error('Agent error:', e)
      return new Response('Internal Server Error', { status: 500 })
    }
  }

  // Helper: Call AutoRAG aiSearch for retrieval-augmented answer and context
  async autoRagSearch(
    query: string,
    options: {
      model?: string
      max_num_results?: number
      rewrite_query?: boolean
      score_threshold?: number
    } = {}
  ) {
    // Replace "my-autorag" with your actual AutoRAG instance name
    const autorag = this.env.AI.autorag('orchestrapi-rag')
    const answer = await autorag.aiSearch({
      query,
      model: options.model, // e.g. "@cf/meta/llama-3.3-70b-instruct-sd"
      rewrite_query: options.rewrite_query ?? true,
      max_num_results: options.max_num_results ?? 5,
      ranking_options: options.score_threshold
        ? { score_threshold: options.score_threshold }
        : undefined,
      stream: true,
    })
    return answer
  }

  // Example: handle a user message with RAG and store all steps in SQL
  async handleUserMessage(threadId: string, userMessage: string) {
    const timestamp = Date.now()
    // 1. Store user message in SQL
    await this.insertTurn({
      threadId,
      role: 'user',
      content: JSON.stringify(userMessage),
      timestamp,
    })

    // 2. Call AutoRAG for answer and context
    const ragResult = await this.autoRagSearch(userMessage)

    // 3. Store the RAG trace and answer in SQL
    await this.insertTurn({
      threadId,
      role: 'assistant',
      content: JSON.stringify(ragResult.response),
      timestamp: Date.now(),
      trace: JSON.stringify({
        ragChunks: ragResult.data,
        search_query: ragResult.search_query,
      }),
    })

    // 4. Return the answer and trace for frontend display
    return {
      answer: ragResult.response,
      trace: {
        ragChunks: ragResult.data,
        search_query: ragResult.search_query,
      },
    }
  }
}
