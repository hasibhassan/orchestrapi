export interface AgentConfig {
  // AI Model Configuration
  ai: {
    model: string
    maxTokens: number
    temperature: number
  }

  // RAG Configuration
  rag: {
    maxResults: number
    scoreThreshold: number
    indexName: string
  }

  // API Configuration
  api: {
    baseUrl: string
    timeout: number
    retryAttempts: number
  }

  // Database Configuration
  database: {
    maxHistoryLength: number
    cleanupInterval: number
  }

  // Streaming Configuration
  streaming: {
    chunkSize: number
    statusUpdateInterval: number
  }
}

export const DEFAULT_CONFIG: AgentConfig = {
  ai: {
    model: '@cf/meta/llama-3.1-8b-instruct',
    maxTokens: 4096,
    temperature: 0.7,
  },
  rag: {
    maxResults: 10,
    scoreThreshold: 0.2,
    indexName: 'orchestrapi-endpoints-rag',
  },
  api: {
    baseUrl: 'https://api.themoviedb.org/3',
    timeout: 10000,
    retryAttempts: 3,
  },
  database: {
    maxHistoryLength: 1000,
    cleanupInterval: 24 * 60 * 60 * 1000, // 24 hours
  },
  streaming: {
    chunkSize: 1024,
    statusUpdateInterval: 1000,
  },
}

export function createConfig(
  overrides: Partial<AgentConfig> = {}
): AgentConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  }
}
