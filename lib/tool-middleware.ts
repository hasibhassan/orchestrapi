import { Ai } from '@cloudflare/ai'
import { createToolsFromOpenAPISpec, runWithTools } from '@cloudflare/ai-utils'
import type { OpenAPIV3 } from 'openapi-types'

export interface Env {
  AI: Ai
}
// Tool schema types
interface ToolParamSchema {
  type: string | undefined
  default?: unknown
}
interface ToolGroupSchema {
  properties: Record<string, ToolParamSchema>
  required: string[]
}
interface ToolSchema {
  path: ToolGroupSchema
  query: ToolGroupSchema
}

// Enhanced tool creation using @cloudflare/ai-utils
export async function createEnhancedToolsFromOpenAPI(
  openApiSpec: OpenAPIV3.Document,
  baseUrl: string,
  apiKey: string
) {
  return await createToolsFromOpenAPISpec(JSON.stringify(openApiSpec), {
    overrides: [
      {
        matcher: ({ url }) => {
          // Apply to all requests to the TMDB API
          return url.hostname === 'api.themoviedb.org'
        },
        values: {
          headers: {
            'Accept': 'application/json',
          },
          query: {
            api_key: apiKey,
          },
        },
      },
    ],
  })
}

// Enhanced tool execution with AI integration
export async function executeToolWithAI(
  ai: Env['AI'],
  model: string,
  toolName: string,
  parameters: Record<string, unknown>,
  openApiSpec: OpenAPIV3.Document,
  baseUrl: string,
  apiKey: string
) {
  const tools = await createEnhancedToolsFromOpenAPI(
    openApiSpec,
    baseUrl,
    apiKey
  )

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runWithTools(ai as any, model, {
      messages: [
        {
          role: 'user',
          content: `Execute the ${toolName} tool with parameters: ${JSON.stringify(
            parameters
          )}`,
        },
      ],
      tools,
    })

    return result
  } catch (error) {
    console.error(`Error executing tool ${toolName}:`, error)
    throw error
  }
}

// Build a map of tool schemas from the OpenAPI spec
export function buildToolSchemasFromOpenAPI(openApiSpec: OpenAPIV3.Document) {
  const toolSchemas: Record<string, ToolSchema> = {}

  for (const [, pathItem] of Object.entries(openApiSpec.paths)) {
    if (typeof pathItem !== 'object' || !pathItem) continue

    const pathItemObj = pathItem as OpenAPIV3.PathItemObject

    for (const method of Object.keys(pathItemObj)) {
      // Only consider HTTP methods
      if (
        ![
          'get',
          'post',
          'put',
          'delete',
          'patch',
          'options',
          'head',
          'trace',
        ].includes(method)
      )
        continue

      const op = (pathItemObj as Record<string, unknown>)[
        method
      ] as OpenAPIV3.OperationObject

      if (!op || typeof op !== 'object' || !('operationId' in op)) continue

      const operationId = op.operationId as string
      const schema: ToolSchema = {
        path: { properties: {}, required: [] },
        query: { properties: {}, required: [] },
      }

      if (Array.isArray(op.parameters)) {
        for (const p of op.parameters as OpenAPIV3.ParameterObject[]) {
          if (!p.name) continue
          const paramName = p.name
          const group = p.in === 'path' ? 'path' : 'query'
          schema[group].properties[paramName] = {
            type: (p.schema as OpenAPIV3.SchemaObject)?.type,
            default: (p.schema as OpenAPIV3.SchemaObject)?.default,
          }
          if (p.required === true) schema[group].required.push(paramName)
        }
      }

      toolSchemas[operationId] = schema
    }
  }

  return toolSchemas
}

// Utility to fill in default values for missing optional parameters
export function fillDefaultsForToolCall(
  toolCall: Record<string, unknown>,
  toolSchema: ToolSchema
): Record<string, unknown> {
  const result = { ...toolCall }

  for (const group of ['path', 'query'] as const) {
    if (!result[group]) result[group] = {}

    for (const [paramName, paramSchema] of Object.entries(
      toolSchema[group].properties
    )) {
      if (
        (result[group] as Record<string, unknown>)[paramName] === undefined &&
        paramSchema.default !== undefined
      ) {
        ;(result[group] as Record<string, unknown>)[paramName] =
          paramSchema.default
      }
    }
  }

  return result
}

// Middleware to coerce types, fill defaults, and validate required params
type ToolCall = Record<string, unknown>
export function fixToolCall(
  toolName: string,
  toolCall: ToolCall,
  toolSchemas: Record<string, ToolSchema>
) {
  const schema = toolSchemas[toolName]
  console.log('fixToolCall', { toolName, toolCall, schema })
  if (!schema) return toolCall // fallback
  const fixed: Record<string, unknown> = { ...toolCall }

  for (const groupKey of Object.keys(schema)) {
    // groupKey is always 'path' or 'query' here
    const group = groupKey as 'path' | 'query'
    if (!fixed[group]) fixed[group] = {}

    for (const paramName of Object.keys(schema[group].properties)) {
      const paramSchema = schema[group].properties[paramName]
      const value = (fixed[group] as Record<string, unknown>)[paramName]

      // Coerce type
      if (
        paramSchema.type === 'integer' &&
        typeof value === 'string' &&
        /^\d+$/.test(value)
      ) {
        ;(fixed[group] as Record<string, unknown>)[paramName] = parseInt(
          value,
          10
        )
      }
      // Fill default
      if (value === undefined && paramSchema.default !== undefined) {
        ;(fixed[group] as Record<string, unknown>)[paramName] =
          paramSchema.default
      }
      // Validate required
      if (
        schema[group].required &&
        schema[group].required.includes(paramName) &&
        (fixed[group] as Record<string, unknown>)[paramName] === undefined
      ) {
        throw new Error(`Missing required parameter: ${paramName} in ${group}`)
      }
    }
  }

  return fixed
}
