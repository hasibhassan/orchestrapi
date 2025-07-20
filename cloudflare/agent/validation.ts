import type { Message as VercelMessage } from 'ai'
import { ValidationError } from './error-handling'

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export class RequestValidator {
  static validateUserMessage(body: Record<string, unknown>): {
    threadId: string
    lastUserMessage: string
    fullMessages: VercelMessage[]
  } {
    const errors: string[] = []

    // Validate threadId
    const threadId =
      typeof body.threadId === 'string' ? body.threadId : 'default'

    // Validate messages array
    if (!Array.isArray(body.messages)) {
      errors.push('Messages must be an array')
      throw new ValidationError('Invalid request format', { errors })
    }

    const messages = body.messages as Array<Record<string, unknown>>
    const allowedRoles = ['user', 'assistant', 'system']

    const fullMessages = messages
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

    // Find the latest user message
    let lastUserMessage: string | undefined
    for (let i = fullMessages.length - 1; i >= 0; i--) {
      if (fullMessages[i].role === 'user') {
        lastUserMessage = fullMessages[i].content
        break
      }
    }

    if (!lastUserMessage?.trim()) {
      errors.push('Missing or empty user message')
    }

    if (errors.length > 0) {
      throw new ValidationError('Validation failed', { errors })
    }

    return { threadId, lastUserMessage: lastUserMessage!, fullMessages }
  }

  static validateExecutionPlan(plan: Record<string, unknown>): boolean {
    const errors: string[] = []

    if (!plan || typeof plan !== 'object') {
      errors.push('Plan must be an object')
    }

    if (!plan.reasoning || typeof plan.reasoning !== 'string') {
      errors.push('Plan must have a reasoning field')
    }

    if (!Array.isArray(plan.steps)) {
      errors.push('Plan must have a steps array')
    }

    if (plan.steps && Array.isArray(plan.steps)) {
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i] as Record<string, unknown>
        if (!step.id || typeof step.id !== 'string') {
          errors.push(`Step ${i} must have an id`)
        }
        if (!step.description || typeof step.description !== 'string') {
          errors.push(`Step ${i} must have a description`)
        }
        if (!step.tool || typeof step.tool !== 'string') {
          errors.push(`Step ${i} must have a tool`)
        }
        if (!step.parameters || typeof step.parameters !== 'object') {
          errors.push(`Step ${i} must have parameters`)
        }
      }
    }

    if (errors.length > 0) {
      throw new ValidationError('Invalid execution plan', { errors })
    }

    return true
  }

  static validateToolCall(
    toolName: string,
    parameters: Record<string, unknown>
  ): boolean {
    const errors: string[] = []

    if (!toolName || typeof toolName !== 'string') {
      errors.push('Tool name must be a string')
    }

    if (!parameters || typeof parameters !== 'object') {
      errors.push('Parameters must be an object')
    }

    if (errors.length > 0) {
      throw new ValidationError('Invalid tool call', { errors })
    }

    return true
  }
}
