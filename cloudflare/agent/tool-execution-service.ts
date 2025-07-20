import { createToolsFromOpenAPISpec, runWithTools } from '@cloudflare/ai-utils'
import type { OpenAPIV3 } from 'openapi-types'
import tmdbOpenApi from '../../lib/tmdb-open-api.json'
import {
  buildToolSchemasFromOpenAPI,
  fixToolCall,
} from '../../lib/tool-middleware'
import { Env, ExecutionPlan, ReasoningTrace } from './types'

// Import the ToolSchema type from tool-middleware
interface ToolSchema {
  path: {
    properties: Record<string, { type: string | undefined; default?: unknown }>
    required: string[]
  }
  query: {
    properties: Record<string, { type: string | undefined; default?: unknown }>
    required: string[]
  }
}

/**
 * Service for executing API calls and managing tool execution
 *
 * This service handles the execution of structured plans by making
 * HTTP requests to external APIs and managing dependencies between steps.
 */
export class ToolExecutionService {
  private toolSchemas: Record<string, ToolSchema> = {}

  /**
   * Creates a new tool execution service instance
   *
   * @param env - The environment object containing API keys and bindings
   */
  constructor(private env: Env) {
    this.initializeToolSchemas()
  }

  /**
   * Initializes the tool schemas from the OpenAPI specification
   *
   * Builds a mapping of tool names to their schemas for validation
   * and parameter fixing during execution.
   *
   * @private
   */
  private initializeToolSchemas() {
    this.toolSchemas = buildToolSchemasFromOpenAPI(
      tmdbOpenApi as OpenAPIV3.Document
    )
    console.log(
      'Initialized tool execution service with',
      Object.keys(this.toolSchemas).length,
      'available tools'
    )
  }

  /**
   * Executes a complete execution plan with dependency management
   *
   * Processes all steps in the plan, handling dependencies between steps
   * and tracking execution status and results.
   *
   * @param plan - The execution plan containing steps to execute
   * @param useAIUtils - Whether to use AI utils for tool execution (default: false)
   * @returns Promise containing execution results and trace information
   *
   * @example
   * ```typescript
   * const toolService = new ToolExecutionService(env)
   * const results = await toolService.executePlan(executionPlan)
   * ```
   */
  async executePlan(plan: ExecutionPlan, useAIUtils: boolean = false) {
    const results: Record<string, unknown> = {}
    const executionTrace: ReasoningTrace['executionTrace'] = []

    const stepMap = new Map(plan.steps.map((step) => [step.id, step]))
    const completed = new Set<string>()

    const executeStep = async (stepId: string): Promise<unknown> => {
      if (completed.has(stepId)) return results[stepId]

      const step = stepMap.get(stepId)
      if (!step) throw new Error(`Step ${stepId} not found`)

      if (step.depends_on) {
        for (const depId of step.depends_on) {
          await executeStep(depId)
        }
      }

      executionTrace.push({ step: step.description, status: 'running' })

      try {
        const result = useAIUtils
          ? await this.executeToolWithAIUtils(step.tool, step.parameters)
          : await this.executeTool(step.tool, step.parameters)

        results[stepId] = result
        completed.add(stepId)

        executionTrace[executionTrace.length - 1].status = 'completed'
        executionTrace[executionTrace.length - 1].details = {
          toolUsed: step.tool,
          resultSize: JSON.stringify(result).length,
          method: useAIUtils ? 'ai-utils' : 'manual',
        }

        return result
      } catch (error) {
        executionTrace[executionTrace.length - 1].status = 'error'
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        executionTrace[executionTrace.length - 1].details = {
          error: errorMessage,
        }
        throw error instanceof Error ? error : new Error(errorMessage)
      }
    }

    for (const step of plan.steps) {
      await executeStep(step.id)
    }

    return { results, executionTrace }
  }

  /**
   * Executes a single tool call using manual URL construction
   *
   * Builds the API URL manually based on the tool name and parameters,
   * then makes the HTTP request to the external API.
   *
   * @param toolName - The name of the tool/API endpoint to call
   * @param parameters - The parameters to pass to the API call
   * @returns Promise containing the API response
   *
   * @example
   * ```typescript
   * const result = await toolService.executeTool('search-movie', {
   *   query: { query: 'Inception' }
   * })
   * ```
   */
  async executeTool(
    toolName: string,
    parameters: Record<string, unknown>
  ): Promise<unknown> {
    console.log(`Executing tool: ${toolName} with parameters:`, parameters)

    try {
      const fixedParams = fixToolCall(toolName, parameters, this.toolSchemas)
      const url = this.buildApiUrl(toolName, fixedParams)

      console.log(`Making request to: ${url.toString()}`)
      url.searchParams.append('api_key', this.env.TMDB_API_KEY)

      const response = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API call failed (${response.status}): ${errorText}`)
      }

      const result = await response.json()
      console.log(`Tool ${toolName} result:`, result)
      return result
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error)
      throw error instanceof Error
        ? error
        : new Error(`Tool execution failed: ${String(error)}`)
    }
  }

  /**
   * Executes a tool call using AI utils for enhanced integration
   *
   * Uses the @cloudflare/ai-utils library to automatically handle
   * OpenAPI integration and AI-assisted tool execution.
   *
   * @param toolName - The name of the tool/API endpoint to call
   * @param parameters - The parameters to pass to the API call
   * @returns Promise containing the API response
   *
   * @example
   * ```typescript
   * const result = await toolService.executeToolWithAIUtils('search-movie', {
   *   query: { query: 'Inception' }
   * })
   * ```
   */
  async executeToolWithAIUtils(
    toolName: string,
    parameters: Record<string, unknown>
  ): Promise<unknown> {
    console.log(
      `Executing tool with AI utils: ${toolName} with parameters:`,
      parameters
    )

    try {
      const tools = await createToolsFromOpenAPISpec(
        JSON.stringify(tmdbOpenApi),
        {
          overrides: [
            {
              matcher: ({ url }) => url.hostname === 'api.themoviedb.org',
              values: {
                headers: { 'Accept': 'application/json' },
                query: { api_key: this.env.TMDB_API_KEY },
              },
            },
          ],
        }
      )

      const result = await runWithTools(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.env.AI as any,
        '@cf/meta/llama-3.1-8b-instruct',
        {
          messages: [
            {
              role: 'user',
              content: `Execute the ${toolName} tool with parameters: ${JSON.stringify(
                parameters
              )}`,
            },
          ],
          tools,
        }
      )

      console.log(`AI Utils Tool ${toolName} result:`, result)
      return result
    } catch (error) {
      console.error(`Error executing AI utils tool ${toolName}:`, error)
      return this.executeTool(toolName, parameters)
    }
  }

  /**
   * Builds the API URL for a given tool and parameters
   *
   * Maps the tool name to the corresponding OpenAPI endpoint and
   * constructs the URL with proper path and query parameters.
   *
   * @param toolName - The name of the tool/API endpoint
   * @param parameters - The parameters to include in the URL
   * @returns The constructed URL for the API call
   *
   * @private
   */
  private buildApiUrl(
    toolName: string,
    parameters: Record<string, unknown>
  ): URL {
    const baseUrl = 'https://api.themoviedb.org/3'
    const paths = (tmdbOpenApi as OpenAPIV3.Document).paths

    const endpoint = Object.entries(paths).find(([, pathDef]) => {
      if (!pathDef) return false
      return Object.values(pathDef).some((methodDef) => {
        if (typeof methodDef !== 'object' || !('operationId' in methodDef))
          return false
        return (methodDef as OpenAPIV3.OperationObject).operationId === toolName
      })
    })

    if (!endpoint) {
      throw new Error(`Endpoint for tool ${toolName} not found`)
    }

    let path = endpoint[0]

    if (parameters.path) {
      for (const [key, value] of Object.entries(
        parameters.path as Record<string, unknown>
      )) {
        path = path.replace(`{${key}}`, String(value))
      }
    }

    const url = new URL(baseUrl + path)

    if (parameters.query) {
      for (const [key, value] of Object.entries(
        parameters.query as Record<string, unknown>
      )) {
        url.searchParams.append(key, String(value))
      }
    }

    return url
  }
}
