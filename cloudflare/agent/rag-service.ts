import { Env } from './types'

/**
 * Service for handling RAG (Retrieval-Augmented Generation) operations
 *
 * This service provides methods to search through API documentation
 * and retrieve relevant context for AI planning and execution.
 */
export class RagService {
  /**
   * Creates a new RAG service instance
   *
   * @param env - The environment object containing AI bindings
   */
  constructor(private env: Env) {}

  /**
   * Searches for relevant API documentation based on a user query
   *
   * Uses Cloudflare's AutoRAG to find the most relevant API documentation
   * chunks that can help answer the user's question.
   *
   * @param query - The user's query to search for relevant documentation
   * @param maxResults - Maximum number of results to return (default: 10)
   * @returns Promise containing the search results with relevant API documentation
   *
   * @example
   * ```typescript
   * const ragService = new RagService(env)
   * const results = await ragService.searchApiDocumentation("find action movies")
   * ```
   */
  async searchApiDocumentation(query: string, maxResults: number = 10) {
    const autorag = this.env.AI.autorag('orchestrapi-endpoints-rag')

    return await autorag.search({
      query: `TMDB API documentation for: ${query}`,
      max_num_results: maxResults,
      rewrite_query: true,
      ranking_options: { score_threshold: 0.2 },
    })
  }
}
