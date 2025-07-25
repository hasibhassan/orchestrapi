/**
 * Tool Execution Service
 *
 * This service is responsible for executing API calls based on a structured
 * plan. It uses the @cloudflare/ai-utils library to create executable
 * tool functions from the OpenAPI spec, ensuring a reliable and
 * deterministic execution flow.
 *
 * @module ToolExecutionService
 */

import { createToolsFromOpenAPISpec } from '@cloudflare/ai-utils'
import { Env, ExecutionPlan, ReasoningTrace } from './types'

// Generic OpenAPI spec interface
interface OpenAPISpec {
  paths: Record<string, Record<string, { operationId: string }>>
  [key: string]: unknown
}

// Define the core tool structure based on the source of ai-utils
interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function: (args: any) => Promise<any>
}

/**
 * Service for executing API calls based on a structured plan.
 */
export class ToolExecutionService {
  private openApiSpec: OpenAPISpec
  private baseUrl: string
  private tools: Tool[] = []

  constructor(private env: Env, openApiSpec: OpenAPISpec, baseUrl: string) {
    this.openApiSpec = openApiSpec
    this.baseUrl = baseUrl
  }

  /**
   * Initializes the service by creating tools from the OpenAPI spec.
   */
  async initialize() {
    this.tools = (await createToolsFromOpenAPISpec(
      JSON.stringify(this.openApiSpec),
      {
        overrides: [
          {
            matcher: ({ url }: { url: URL }) =>
              url.hostname === new URL(this.baseUrl).hostname,
            values: {
              headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${this.env.TMDB_API_TOKEN}`,
              },
            },
          },
        ],
      }
    )) as Tool[]
  }

  private interpolateParameters(
    parameters: Record<string, unknown>,
    results: Record<string, unknown>
  ): Record<string, unknown> {
    const interpolate = (value: unknown): unknown => {
      if (typeof value === 'string') {
        const match = value.match(/\{\{([\w\d_]+)\.([\w\d_\[\].]+)\}\}/)
        if (match) {
          const stepId = match[1]
          const path = match[2]
          const stepResult = results[stepId]

          if (stepResult) {
            try {
              const pathParts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
              let v: unknown = stepResult
              for (const part of pathParts) {
                if (v == null) break
                v = (v as Record<string, unknown>)[part]
              }
              // Unlike the direct fetch implementation, we can pass objects here
              return v
            } catch {
              return value
            }
          }
        }
        return value
      } else if (Array.isArray(value)) {
        return value.map(interpolate)
      } else if (typeof value === 'object' && value !== null) {
        const out: Record<string, unknown> = {}
        for (const k in value) {
          out[k] = interpolate((value as Record<string, unknown>)[k])
        }
        return out
      }
      return value
    }
    return interpolate(parameters) as Record<string, unknown>
  }

  async executePlan(plan: ExecutionPlan) {
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
        const interpolatedParams = this.interpolateParameters(
          step.parameters,
          results
        )

        const result = await this.executeTool(step.tool, interpolatedParams)

        results[stepId] = result
        completed.add(stepId)

        const lastTrace = executionTrace[executionTrace.length - 1]
        lastTrace.status = 'completed'
        lastTrace.details = {
          toolUsed: step.tool,
          resultSize: JSON.stringify(result).length,
          method: 'ai-utils-function-call',
          interpolatedParameters: interpolatedParams,
        }

        return result
      } catch (error) {
        const lastTrace = executionTrace[executionTrace.length - 1]
        lastTrace.status = 'error'
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        lastTrace.details = { error: errorMessage }

        throw error instanceof Error ? error : new Error(errorMessage)
      }
    }

    for (const step of plan.steps) {
      await executeStep(step.id)
    }

    return { results, executionTrace }
  }

  private async executeTool(
    toolName: string,
    parameters: Record<string, unknown>
  ): Promise<unknown> {
    const tool = this.tools.find((t) => t.name === toolName)
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`)
    }

    // Deep clone the parameters to prevent mutation by the tool function
    const clonedParameters = JSON.parse(JSON.stringify(parameters))

    const result = await tool.function(clonedParameters)

    // The utility function returns a string, so we need to parse it
    try {
      return JSON.parse(result)
    } catch {
      return result // Return as-is if not valid JSON
    }
  }
}
