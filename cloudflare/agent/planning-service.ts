import type { Message as VercelMessage } from 'ai'
import { generateObject } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { z } from 'zod'
import { Env, ExecutionPlan } from './types'

const planSchema = z.object({
  reasoning: z.string(),
  steps: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      tool: z.string(),
      parameters: z.record(z.any()),
      depends_on: z.array(z.string()).optional(),
    })
  ),
  expected_outcome: z.string(),
})

export class PlanningService {
  constructor(private env: Env) {}

  private buildPlanningPrompt(apiDocs: string, userQuery: string): string {
    return `You are an AI agent that creates execution plans for API queries.

Given a user query and relevant API documentation, create a detailed execution plan with specific API calls using the actual operation IDs from the provided API documentation.

### User Query
"${userQuery}"

### Available API Documentation
${apiDocs}

### General Planning Guidelines
- **Use the most specific and relevant API parameters and endpoints.**
- **For date-based queries, use appropriate date range parameters (e.g., \`release_date.gte\`, \`primary_release_date.lte\`).**
- **When a query requires details for multiple entities (e.g., find all movies for an actor), create a multi-step plan:**
  1. First, use a search or discover endpoint to get a list of relevant IDs.
  2. Then, for each ID, call the appropriate detail endpoint.
  3. Aggregate the results to answer the user's question.
- **Always pass real IDs or other required data from previous step results to subsequent API calls.** For example, use \`{{step1.results.0.id}}\` to pass the ID from the first result of step 1.
- **If a previous step returns a list, you MUST ONLY process the *first* item.** For example, use \`{{step1.results.0.id}}\` to get the ID of the first movie found. Never use wildcards like \`*\`.
- **If the query is ambiguous, retrieve a broad set of results and filter or aggregate as needed.**
- **Ensure the plan is as short and efficient as possible (2–4 steps max), but covers all necessary dependencies.**
- **Only use tools/endpoints that exist in the provided API documentation.**

### CRITICAL RULE
- **You MUST ONLY use the tools listed in the "Available API Documentation".**
- **NEVER invent a tool for any purpose.** All data processing happens *after* the plan is executed.
- **ALL tool parameters MUST be nested under a \`query\` or \`path\` key.** Path parameters (like \`movie_id\`) go under \`path\`. All other parameters go under \`query\`.

### Planning Rules
- **Output ONLY valid JSON.**
- **Your response will be ignored and retried if it's not valid JSON.**
- **A good plan is 1-3 steps. Be concise.**
- **Example of a robust, multi-step plan for resolving an entity ID:**
  \`\`\`json
  {
    "reasoning": "To find the plot of Inception, I first need its ID. I will use 'search-movie' to find the ID, then 'movie-details' to get the plot.",
    "steps": [
      {
        "id": "step1",
        "tool": "search-movie",
        "description": "Find the ID for the movie 'Inception'.",
        "parameters": { "query": { "query": "Inception" } },
        "depends_on": []
      },
      {
        "id": "step2",
        "tool": "movie-details",
        "description": "Get the details for the movie.",
        "parameters": { "path": { "movie_id": "{{step1.results.0.id}}" } },
        "depends_on": ["step1"]
      }
    ],
    "expected_outcome": "The plot summary for the movie Inception."
  }
  \`\`\`
`
  }

  async createExecutionPlan(
    userQuery: string,
    apiDocs: string,
    conversationHistory: VercelMessage[]
  ): Promise<ExecutionPlan> {
    const workersai = createWorkersAI({ binding: this.env.AI })
    const model = workersai('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b')
    const prompt =
      this.buildPlanningPrompt(apiDocs, userQuery) +
      '\n' +
      conversationHistory
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n') +
      `\nUser: ${userQuery}`

    let plan: ExecutionPlan | null = null
    let attempts = 0
    while (attempts < 3) {
      try {
        const result = await generateObject({
          model,
          prompt,
          schema: planSchema,
        })
        plan = result.object as ExecutionPlan
        if (
          typeof plan === 'object' &&
          plan !== null &&
          'reasoning' in plan &&
          'steps' in plan &&
          Array.isArray(plan.steps)
        ) {
          break
        }
      } catch (e) {
        console.warn(
          '🧠 [PLANNING] Plan parse/validation failed, attempt',
          attempts + 1,
          e
        )
      }
      attempts++
    }

    if (!plan) {
      plan = this.createFallbackPlan(userQuery)
    }
    return plan
  }

  private createFallbackPlan(userQuery: string): ExecutionPlan {
    const safeQuery =
      typeof userQuery === 'string' ? userQuery.slice(0, 500) : ''
    return {
      reasoning:
        'Fallback plan: search for user query using the most relevant endpoint.',
      steps: [
        {
          id: 'step1',
          description: 'Search for relevant data based on the user query.',
          tool: 'search-multi',
          parameters: {
            query: { query: safeQuery },
          },
          depends_on: [],
        },
      ],
      expected_outcome: 'A list of search results for the user query.',
    }
  }
}
