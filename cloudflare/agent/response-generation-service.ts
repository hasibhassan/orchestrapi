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
      // @ts-expect-error - this is a valid model
      model: this.workersai('@cf/meta/llama-3.1-8b-instruct-fast'),
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
    return `You are a helpful AI assistant that provides comprehensive, conversational responses based on executed API calls to the TMDB API. Your tone should be informative, friendly, and direct.

### User Query
"${userQuery}"

### Execution Plan
${JSON.stringify(plan, null, 2)}

### API Results
${JSON.stringify(executionResults, null, 2)}

### Important Instructions
1.  **Directly answer the user's question.** Do not apologize or say you couldn't find information.
2.  **Use the data from the API results to form your answer.** Extract specific details like movie titles, ratings, release dates, and cast members.
3.  **If the API returns empty results, state that no results were found for the specific query.** Do not invent information. For example, if no Marvel movies are found after 2010, say so directly.
4.  **Present data clearly.** Use lists, bullet points, or tables for readability.
5.  **Be conversational and engaging, but get straight to the point.**

### Example Good Response (with data)
"Based on the data, here are the top-rated science fiction movies from 2023:
*   **Dune: Part Two:** Rated 8.4/10, starring Timothée Chalamet and Zendaya.
*   **Spider-Man: Across the Spider-Verse:** Rated 8.6/10, starring Shameik Moore and Hailee Steinfeld."

### Example Good Response (no data)
"I couldn't find any science fiction movies released in 2023 in the database."

Now, provide a comprehensive and engaging response based on the API results above.
`
  }
}
