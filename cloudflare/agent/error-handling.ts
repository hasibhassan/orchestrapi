export class AgentError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

export class ValidationError extends AgentError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details)
    this.name = 'ValidationError'
  }
}

export class ApiError extends AgentError {
  constructor(
    message: string,
    statusCode: number,
    details?: Record<string, unknown>
  ) {
    super(message, 'API_ERROR', statusCode, details)
    this.name = 'ApiError'
  }
}

export class PlanningError extends AgentError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PLANNING_ERROR', 500, details)
    this.name = 'PlanningError'
  }
}

export class ExecutionError extends AgentError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'EXECUTION_ERROR', 500, details)
    this.name = 'ExecutionError'
  }
}

export function handleError(error: unknown): AgentError {
  if (error instanceof AgentError) {
    return error
  }

  if (error instanceof Error) {
    return new AgentError(error.message, 'UNKNOWN_ERROR', 500)
  }

  return new AgentError(String(error), 'UNKNOWN_ERROR', 500)
}

export function createErrorResponse(error: AgentError): Response {
  const errorBody = {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  }

  return new Response(JSON.stringify(errorBody), {
    status: error.statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
