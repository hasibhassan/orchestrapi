import type { Message as VercelMessage } from 'ai'
import { DatabaseService } from './database-service'
import { PlanningService } from './planning-service'
import { RagService } from './rag-service'
import { ResponseGenerationService } from './response-generation-service'
import { ToolExecutionService } from './tool-execution-service'
import { ReasoningTrace } from './types'

/**
 * Service for orchestrating the complete RAG workflow with streaming
 *
 * This service coordinates all other services to execute the complete
 * agentic AI + RAG workflow while providing real-time updates to the client.
 */
export class StreamingOrchestrator {
  /**
   * Creates a new streaming orchestrator instance
   *
   * @param ragService - Service for RAG operations
   * @param planningService - Service for AI planning
   * @param toolExecutionService - Service for API execution
   * @param responseGenerationService - Service for response generation
   * @param databaseService - Service for data persistence
   */
  constructor(
    private ragService: RagService,
    private planningService: PlanningService,
    private toolExecutionService: ToolExecutionService,
    private responseGenerationService: ResponseGenerationService,
    private databaseService: DatabaseService
  ) {}

  /**
   * Orchestrates the complete RAG workflow with streaming updates
   *
   * Executes the 4-step process (RAG Search → Planning → Execution → Response)
   * while providing real-time status updates and trace information to the client.
   *
   * @param threadId - The conversation thread ID
   * @param userMessage - The user's message to process
   * @param fullMessages - Complete conversation history
   * @param controller - The stream controller for sending updates
   *
   * @example
   * ```typescript
   * const orchestrator = new StreamingOrchestrator(
   *   ragService,
   *   planningService,
   *   toolExecutionService,
   *   responseGenerationService,
   *   databaseService
   * )
   *
   * await orchestrator.orchestrateRagWorkflow(
   *   threadId,
   *   userMessage,
   *   conversationHistory,
   *   streamController
   * )
   * ```
   */
  async orchestrateRagWorkflow(
    threadId: string,
    userMessage: string,
    fullMessages: VercelMessage[],
    controller: ReadableStreamDefaultController
  ) {
    const encoder = new TextEncoder()
    const trace: ReasoningTrace = {
      planningSteps: [],
      toolCalls: [],
      executionTrace: [],
    }

    try {
      // Step 1: RAG Search
      await this.sendStatus(
        controller,
        encoder,
        'Searching API documentation...'
      )
      const apiSearchResult = await this.ragService.searchApiDocumentation(
        userMessage
      )

      trace.ragChunks = apiSearchResult.data.map(
        (chunk: Record<string, unknown>) => ({
          id: (chunk.id as string) || crypto.randomUUID(),
          text:
            (chunk.content as Array<Record<string, unknown>>)
              ?.map((c: Record<string, unknown>) => c.text as string)
              .join(' ') || '',
          score: (chunk.score as number) || 0,
        })
      )
      trace.searchQuery =
        (apiSearchResult.search_query as string) || userMessage

      const apiDocs = apiSearchResult.data
        .map(
          (chunk: Record<string, unknown>) =>
            (chunk.content as Array<Record<string, unknown>>)
              ?.map((c: Record<string, unknown>) => c.text as string)
              .join(' ') || ''
        )
        .join('\n\n')

      await this.sendTrace(
        controller,
        encoder,
        'documentation_search',
        trace.ragChunks?.slice(0, 3) || []
      )

      // Step 2: Planning
      await this.sendStatus(controller, encoder, 'Planning execution steps...')
      const plan = await this.planningService.createExecutionPlan(
        userMessage,
        apiDocs,
        fullMessages
      )

      trace.planningSteps = [
        plan.reasoning,
        ...plan.steps.map((s) => s.description),
      ]

      await this.sendTrace(controller, encoder, 'execution_plan', {
        reasoning: plan.reasoning,
        steps: plan.steps.length,
      })

      // Step 3: Execution
      await this.sendStatus(controller, encoder, 'Executing API calls...')
      const executionResults = await this.toolExecutionService.executePlan(plan)

      trace.executionTrace = executionResults.executionTrace
      trace.toolCalls = plan.steps.map((step) => ({
        name: step.tool,
        args: step.parameters,
        result: executionResults.results[step.id],
      }))

      // Send tool call traces
      for (const step of plan.steps) {
        const result = executionResults.results[step.id]
        const executionStep = executionResults.executionTrace.find(
          (trace: Record<string, unknown>) => trace.step === step.description
        )

        await this.sendTrace(controller, encoder, 'tool_call', {
          tool: step.tool,
          args: step.parameters,
          result: result,
          status: (executionStep?.status as string) || 'completed',
        })
      }

      await this.sendTrace(
        controller,
        encoder,
        'execution_complete',
        trace.executionTrace
      )

      // Step 4: Response Generation
      await this.sendStatus(controller, encoder, 'Generating response...')
      const responseStream =
        await this.responseGenerationService.generateFinalResponse(
          userMessage,
          plan,
          executionResults.results,
          fullMessages
        )

      // Stream the final response
      let fullResponse = ''
      for await (const chunk of responseStream.textStream) {
        fullResponse += chunk
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: 'content', text: chunk }) + '\n'
          )
        )
      }

      // Store final response with trace
      await this.databaseService.insertTurn({
        threadId,
        role: 'assistant',
        content: fullResponse,
        timestamp: Date.now(),
        trace: JSON.stringify(trace),
      })

      // Update thread metadata
      await this.databaseService.upsertThread({
        threadId,
        title:
          fullResponse.slice(0, 100) + (fullResponse.length > 100 ? '...' : ''),
        lastUpdated: Date.now(),
      })

      controller.enqueue(
        encoder.encode(JSON.stringify({ type: 'done' }) + '\n')
      )
    } catch (error) {
      console.error('Orchestration error:', error)
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred during processing'
      controller.enqueue(
        encoder.encode(
          JSON.stringify({ type: 'error', message: errorMessage }) + '\n'
        )
      )
      throw error
    }
  }

  /**
   * Sends a status update to the client
   *
   * @param controller - The stream controller
   * @param encoder - The text encoder
   * @param message - The status message to send
   *
   * @private
   */
  private async sendStatus(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    message: string
  ) {
    controller.enqueue(
      encoder.encode(JSON.stringify({ type: 'status', message }) + '\n')
    )
  }

  /**
   * Sends trace information to the client
   *
   * @param controller - The stream controller
   * @param encoder - The text encoder
   * @param step - The step name
   * @param data - The trace data to send
   *
   * @private
   */
  private async sendTrace(
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    step: string,
    data: Record<string, unknown> | unknown[]
  ) {
    controller.enqueue(
      encoder.encode(
        JSON.stringify({ type: 'trace', trace: { step, data } }) + '\n'
      )
    )
  }
}
