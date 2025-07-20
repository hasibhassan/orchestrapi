import type { Message as VercelMessage } from 'ai'
import { streamText } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { Env, ExecutionPlan } from './types'

/**
 * Service for generating final AI responses
 *
 * This service takes the results of API executions and generates
 * natural language responses that are conversational and informative.
 */
export class ResponseGenerationService {
  private workersai = createWorkersAI({ binding: this.env.AI })

  /**
   * Creates a new response generation service instance
   *
   * @param env - The environment object containing AI bindings
   */
  constructor(private env: Env) {}

  /**
   * Generates a final response based on execution results
   *
   * Takes the user query, execution plan, and results to create
   * a natural language response that answers the user's question.
   *
   * @param userQuery - The original user query
   * @param plan - The execution plan that was carried out
   * @param executionResults - The results from API calls
   * @param conversationHistory - Previous conversation messages for context
   * @returns Promise containing a streaming text response
   *
   * @example
   * ```typescript
   * const responseService = new ResponseGenerationService(env)
   * const responseStream = await responseService.generateFinalResponse(
   *   "Find action movies from 2023",
   *   executionPlan,
   *   executionResults,
   *   conversationHistory
   * )
   * ```
   */
  async generateFinalResponse(
    userQuery: string,
    plan: ExecutionPlan,
    executionResults: Record<string, unknown>,
    conversationHistory: VercelMessage[]
  ) {
    const systemPrompt = this.buildResponsePrompt(
      userQuery,
      plan,
      executionResults
    )

    return await streamText({
      model: this.workersai('@cf/meta/llama-3.1-8b-instruct'),
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userQuery },
      ],
    })
  }

  /**
   * Builds the system prompt for response generation
   *
   * Creates a comprehensive prompt that instructs the AI on how to
   * synthesize API results into a natural language response.
   *
   * @param userQuery - The original user query
   * @param plan - The execution plan that was carried out
   * @param executionResults - The results from API calls
   * @returns The formatted system prompt
   *
   * @private
   */
  private buildResponsePrompt(
    userQuery: string,
    plan: ExecutionPlan,
    executionResults: Record<string, unknown>
  ): string {
    return `You are a helpful AI assistant that provides comprehensive, conversational responses based on executed API calls to TMDB.

The user asked: "${userQuery}"

Execution plan that was carried out:
${JSON.stringify(plan, null, 2)}

Results from API calls:
${JSON.stringify(executionResults, null, 2)}

Please provide a natural, conversational response that:
1. Directly answers the user's question
2. Uses the specific data from the API results
3. Is well-formatted and easy to read
4. Includes relevant details like ratings, release dates, cast members, etc.
5. If multiple results were found, present them in a clear, organized way

Be engaging and informative, but stay focused on what the user asked for.`
  }
}
