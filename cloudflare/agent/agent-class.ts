import { Agent } from 'agents'
import type { Message as VercelMessage } from 'ai'
import { DatabaseService } from './database-service'
import { PlanningService } from './planning-service'
import { RagService } from './rag-service'
import { ResponseGenerationService } from './response-generation-service'
import { StreamingOrchestrator } from './streaming-orchestrator'
import { ToolExecutionService } from './tool-execution-service'
import { Env } from './types'

// Define the interface inline to avoid circular dependencies
interface AgentWithEnv {
  sql<T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>
  env: {
    AI: unknown
    TMDB_API_KEY: string
    TMDB_API_TOKEN: string
  }
}

/**
 * Main agent class that orchestrates the complete RAG workflow
 *
 * This class coordinates all services to provide agentic AI + RAG capabilities
 * for processing natural language queries and executing API calls to TMDB.
 */
export class OrchestrApiAgent extends Agent<Env> {
  private databaseService!: DatabaseService
  private ragService!: RagService
  private planningService!: PlanningService
  private toolExecutionService!: ToolExecutionService
  private responseGenerationService!: ResponseGenerationService
  private orchestrator!: StreamingOrchestrator

  /**
   * Initializes the agent and all its services
   *
   * Sets up all service instances and initializes the database.
   * This method is called when the agent starts.
   */
  async onStart() {
    // Initialize services
    this.databaseService = new DatabaseService(this as unknown as AgentWithEnv)
    this.ragService = new RagService(this.env)
    this.planningService = new PlanningService(this.env)
    // For now, we'll use TMDB as the default API
    // In the future, this could be made configurable based on the request or environment
    const tmdbOpenApi = await import('../../lib/tmdb-open-api.json')
    this.toolExecutionService = new ToolExecutionService(
      this.env,
      tmdbOpenApi.default,
      'https://api.themoviedb.org/3'
    )
    await this.toolExecutionService.initialize()
    this.responseGenerationService = new ResponseGenerationService(this.env)
    this.orchestrator = new StreamingOrchestrator(
      this.ragService,
      this.planningService,
      this.toolExecutionService,
      this.responseGenerationService,
      this.databaseService
    )

    // Initialize database
    await this.databaseService.initialize()
  }

  /**
   * Extracts and validates user message from request body
   *
   * Parses the request body to extract the user's message and
   * conversation history, with proper validation.
   *
   * @param body - The request body containing the message data
   * @returns Object containing threadId, lastUserMessage, and fullMessages
   *
   * @private
   */
  private extractUserMessage(body: Record<string, unknown>): {
    threadId: string
    lastUserMessage: string
    fullMessages: VercelMessage[]
  } {
    const threadId =
      typeof body.threadId === 'string' ? body.threadId : 'default'
    const messages = Array.isArray(body.messages) ? body.messages : []

    const allowedRoles = ['user', 'assistant', 'system']
    const fullMessages: VercelMessage[] = messages
      .filter((m: Record<string, unknown>) =>
        allowedRoles.includes(m.role as string)
      )
      .map((m: Record<string, unknown>) => ({
        id: crypto.randomUUID(),
        role: m.role as 'user' | 'assistant' | 'system',
        content:
          (m.content as Array<Record<string, unknown>>)
            ?.filter((c: Record<string, unknown>) => c.type === 'text')
            ?.map((c: Record<string, unknown>) => c.text as string)
            ?.join('\n') || '',
      }))

    let lastUserMessage: string | undefined
    for (let i = fullMessages.length - 1; i >= 0; i--) {
      if (fullMessages[i].role === 'user') {
        lastUserMessage = fullMessages[i].content
        break
      }
    }

    if (!lastUserMessage?.trim()) {
      throw new Response('Missing or invalid message', { status: 400 })
    }

    return { threadId, lastUserMessage, fullMessages }
  }

  /**
   * Main request handler for the agent
   *
   * Processes incoming requests, extracts user messages, and orchestrates
   * the complete RAG workflow with streaming responses.
   *
   * @param request - The incoming HTTP request
   * @returns Promise containing the streaming response
   */
  async onRequest(request: Request): Promise<Response> {
    console.log('Agent: Starting orchestration request')

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    try {
      const body: Record<string, unknown> = await request.json()
      const { threadId, lastUserMessage, fullMessages } =
        this.extractUserMessage(body)

      // Store user message
      await this.databaseService.insertTurn({
        threadId,
        role: 'user',
        content: lastUserMessage,
        timestamp: Date.now(),
      })

      // Create streaming response
      const stream = new ReadableStream({
        start: async (controller) => {
          try {
            await this.orchestrator.orchestrateRagWorkflow(
              threadId,
              lastUserMessage,
              fullMessages,
              controller
            )
            controller.close()
          } catch (error) {
            console.error('Error in orchestrateRagWorkflow:', error)
            controller.close()
          }
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/x-unknown',
          'content-encoding': 'identity',
          'transfer-encoding': 'chunked',
          'Cache-Control': 'no-cache',
        },
      })
    } catch (error) {
      console.error('Request processing error:', error)
      const errorMessage =
        error instanceof Error ? error.message : 'Internal Server Error'
      return new Response(errorMessage, { status: 500 })
    }
  }
}
