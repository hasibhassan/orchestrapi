import type { Message as VercelMessage } from 'ai'
import { generateText } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { Env, ExecutionPlan } from './types'

/**
 * Service for creating execution plans using AI
 *
 * This service is responsible for analyzing user queries and generating
 * structured execution plans that can be executed by the tool execution service.
 */
export class PlanningService {
  private workersai = createWorkersAI({ binding: this.env.AI })

  /**
   * Creates a new planning service instance
   *
   * @param env - The environment object containing AI bindings
   */
  constructor(private env: Env) {}

  /**
   * Creates an execution plan based on user query and API documentation
   *
   * Analyzes the user's request and available API documentation to create
   * a structured plan with multiple steps that can be executed sequentially.
   *
   * @param userQuery - The user's natural language query
   * @param apiDocs - Retrieved API documentation context
   * @param conversationHistory - Previous conversation messages for context
   * @returns Promise containing the structured execution plan
   *
   * @example
   * ```typescript
   * const planningService = new PlanningService(env)
   * const plan = await planningService.createExecutionPlan(
   *   "Find action movies from 2023",
   *   apiDocumentation,
   *   conversationHistory
   * )
   * ```
   */
  async createExecutionPlan(
    userQuery: string,
    apiDocs: string,
    conversationHistory: VercelMessage[]
  ): Promise<ExecutionPlan> {
    const systemPrompt = this.buildPlanningPrompt(apiDocs)

    const result = await generateText({
      model: this.workersai('@cf/meta/llama-3.1-8b-instruct'),
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userQuery },
      ],
    })

    return this.parseExecutionPlan(result.text)
  }

  /**
   * Builds the system prompt for AI planning
   *
   * Creates a comprehensive prompt that instructs the AI on how to
   * create execution plans for TMDB API queries.
   *
   * @param apiDocs - The API documentation context
   * @returns The formatted system prompt
   *
   * @private
   */
  private buildPlanningPrompt(apiDocs: string): string {
    return `You are an AI agent that creates execution plans for TMDB (The Movie Database) API queries. 

Given a user query and relevant API documentation, create a detailed execution plan with specific API calls.

Available API operations include:
- search-movie: Search for movies by title/keywords
- movie-details: Get detailed information about a specific movie
- movie-similar: Get similar movies to a given movie
- movie-credits: Get cast and crew information
- person-details: Get information about a person (actor, director, etc.)
- person-movie-credits: Get movie credits for a person
- discover-movie: Discover movies with filters (genre, year, rating, etc.)

API Documentation Context:
${apiDocs}

Consider the conversation history and create a plan that:
1. Breaks down complex queries into logical steps
2. Uses appropriate API calls with realistic parameters  
3. Handles dependencies between steps (e.g., search first, then get details)
4. Provides clear reasoning for each step

Important: Parameters should match the TMDB API schema exactly. For movie IDs, use integers. For search queries, use strings.

Respond with a JSON object in this exact format:
{
  "reasoning": "Your reasoning about what needs to be done",
  "steps": [
    {
      "id": "step1",
      "description": "Human readable description of this step",
      "tool": "search-movie",
      "parameters": {
        "query": {
          "query": "movie title"
        }
      }
    }
  ],
  "expected_outcome": "What the user should expect as the final result"
}`
  }

  /**
   * Parses the AI response into a structured execution plan
   *
   * Attempts to extract and validate the JSON plan from the AI response.
   * Falls back to a simple plan if parsing fails.
   *
   * @param response - The raw AI response text
   * @returns The parsed execution plan
   *
   * @private
   */
  private parseExecutionPlan(response: string): ExecutionPlan {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }

      const parsed = JSON.parse(jsonMatch[0])

      if (!parsed.reasoning || !parsed.steps || !Array.isArray(parsed.steps)) {
        throw new Error('Invalid plan structure')
      }

      return parsed
    } catch (error) {
      console.error('Failed to parse execution plan:', error)
      console.error('Raw response:', response)

      return this.createFallbackPlan(response)
    }
  }

  /**
   * Creates a fallback execution plan when parsing fails
   *
   * Provides a simple, safe fallback plan that can handle basic queries
   * when the AI response cannot be parsed properly.
   *
   * @param userQuery - The original user query
   * @returns A basic fallback execution plan
   *
   * @private
   */
  private createFallbackPlan(userQuery: string): ExecutionPlan {
    return {
      reasoning: 'Using fallback plan due to parsing error',
      steps: [
        {
          id: 'search',
          description: 'Search for movies based on user query',
          tool: 'search-movie',
          parameters: {
            query: {
              query: userQuery,
            },
          },
        },
      ],
      expected_outcome: 'Find relevant movies and provide information',
    }
  }
}
