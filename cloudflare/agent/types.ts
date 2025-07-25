export interface Env {
  AI: Ai
  TMDB_API_KEY: string
  TMDB_API_TOKEN: string
}

export interface ConversationTurn {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: unknown
  timestamp: number
  trace?: ReasoningTrace
}

export interface ReasoningTrace {
  ragChunks?: Array<{ id: string; text: string; score: number }>
  searchQuery?: string
  planningSteps?: string[]
  toolCalls?: Array<{ name: string; args: unknown; result?: unknown }>
  executionTrace?: Array<{
    step: string
    status: 'pending' | 'running' | 'completed' | 'error'
    details?: unknown
  }>
}

export interface ThreadMetadata {
  threadId: string
  title: string
  lastUpdated: number
}

export interface ExecutionStep {
  id: string
  description: string
  tool: string
  parameters: Record<string, unknown>
  depends_on?: string[]
}

export interface ExecutionPlan {
  reasoning: string
  steps: ExecutionStep[]
  expected_outcome: string
}

export interface HistoryRow {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  trace?: string
}

export interface ThreadRow {
  threadId: string
  title: string
  lastUpdated: number
}
