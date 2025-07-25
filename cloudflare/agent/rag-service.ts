import { DEFAULT_CONFIG } from './config'
import { Env } from './types'

/**
 * Service for RAG operations using AutoRAG
 *
 * This service handles searching through TMDB API documentation
 * to find relevant endpoints and operation details for user queries.
 */
export class RagService {
  private config = DEFAULT_CONFIG

  /**
   * Creates a new RAG service instance
   *
   * @param env - The environment object containing AI bindings
   */
  constructor(private env: Env) {}

  /**
   * Searches API documentation for relevant endpoints
   *
   * Uses Cloudflare's AutoRAG to search through TMDB API documentation
   * and find the most relevant endpoints for a given user query.
   *
   * @param userQuery - The user's natural language query
   * @returns Promise containing search results with relevant API documentation
   *
   * @example
   * ```typescript
   * const ragService = new RagService(env)
   * const results = await ragService.searchApiDocumentation("Find action movies")
   * ```
   */
  async searchApiDocumentation(userQuery: string) {
    console.log('🔍 [RAG] Searching for:', userQuery)

    try {
      // Use AutoRAG to search through TMDB API documentation
      const autorag = this.env.AI.autorag(this.config.rag.indexName)
      const searchResult = await autorag.search({
        query: userQuery,
        rewrite_query: true,
        max_num_results: this.config.rag.maxResults,
        ranking_options: {
          score_threshold: this.config.rag.scoreThreshold,
        },
      })

      console.log(
        '✅ [RAG] Found',
        searchResult.data.length,
        'relevant endpoints'
      )

      // Enhance the results with better context
      const enhancedResults = {
        ...searchResult,
        data: searchResult.data.map(
          (chunk: Record<string, unknown>, index: number) => ({
            ...chunk,
            relevance_score: searchResult.data.length - index, // Higher score for more relevant results
            operation_id: this.extractOperationId(chunk),
            endpoint_type: this.categorizeEndpoint(chunk),
          })
        ),
      }

      return enhancedResults
    } catch (error) {
      console.error('❌ [RAG] Error searching API documentation:', error)

      // Provide a fallback response if AutoRAG is not available
      if (
        error instanceof Error &&
        error.message.includes('Cannot read properties of undefined')
      ) {
        console.warn('⚠️ [RAG] Using fallback documentation')
        return this.getFallbackDocumentation(userQuery)
      }

      throw new Error(
        `Failed to search API documentation: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  /**
   * Provides fallback documentation when AutoRAG is not available
   *
   * @param userQuery - The user's query
   * @returns Fallback documentation
   *
   * @private
   */
  private getFallbackDocumentation(userQuery: string) {
    console.log('RAG Service: Using fallback documentation')

    // Return comprehensive TMDB API documentation for common endpoints
    const fallbackDocs = [
      {
        id: 'search-movie',
        content: [
          {
            type: 'text',
            text: 'search-movie: Search for movies by title, keywords, or other criteria. Parameters: query (string), include_adult (boolean), language (string), primary_release_year (string), page (integer), region (string), year (string)',
          },
        ],
        score: 0.95,
        operation_id: 'search-movie',
        endpoint_type: 'search',
      },
      {
        id: 'discover-movie',
        content: [
          {
            type: 'text',
            text: 'discover-movie: Discover movies with filters like genre, year, rating, etc. Parameters: with_genres (string), with_companies (string), with_cast (string), with_crew (string), with_people (string), primary_release_date.gte (string), primary_release_date.lte (string), primary_release_year.gte (string), primary_release_year.lte (string), sort_by (string), page (integer), vote_average.gte (number), vote_average.lte (number)',
          },
        ],
        score: 0.9,
        operation_id: 'discover-movie',
        endpoint_type: 'discover',
      },
      {
        id: 'movie-details',
        content: [
          {
            type: 'text',
            text: 'movie-details: Get detailed information about a specific movie by ID. Parameters: movie_id (path, integer, required), append_to_response (string), language (string)',
          },
        ],
        score: 0.85,
        operation_id: 'movie-details',
        endpoint_type: 'details',
      },
      {
        id: 'movie-credits',
        content: [
          {
            type: 'text',
            text: 'movie-credits: Get the cast and crew for a movie. Parameters: movie_id (path, integer, required), language (string)',
          },
        ],
        score: 0.8,
        operation_id: 'movie-credits',
        endpoint_type: 'credits',
      },
      {
        id: 'search-person',
        content: [
          {
            type: 'text',
            text: 'search-person: Search for people (actors, directors, etc.) by name. Parameters: query (string), include_adult (boolean), language (string), page (integer)',
          },
        ],
        score: 0.75,
        operation_id: 'search-person',
        endpoint_type: 'search',
      },
      {
        id: 'search-company',
        content: [
          {
            type: 'text',
            text: 'search-company: Search for production companies by name. Parameters: query (string), page (integer)',
          },
        ],
        score: 0.72,
        operation_id: 'search-company',
        endpoint_type: 'search',
      },
      {
        id: 'person-details',
        content: [
          {
            type: 'text',
            text: 'person-details: Get detailed information about a person by ID. Parameters: person_id (path, integer, required), append_to_response (string), language (string)',
          },
        ],
        score: 0.7,
        operation_id: 'person-details',
        endpoint_type: 'details',
      },
      {
        id: 'person-movie-credits',
        content: [
          {
            type: 'text',
            text: 'person-movie-credits: Get the movie credits for a person. Parameters: person_id (path, integer, required), language (string)',
          },
        ],
        score: 0.65,
        operation_id: 'person-movie-credits',
        endpoint_type: 'credits',
      },
      {
        id: 'genre-movie-list',
        content: [
          {
            type: 'text',
            text: 'genre-movie-list: Get the list of official genres for movies. Parameters: language (string)',
          },
        ],
        score: 0.6,
        operation_id: 'genre-movie-list',
        endpoint_type: 'genre',
      },
    ]

    return {
      data: fallbackDocs,
      search_query: userQuery,
      object: 'vector_store.search_results.page',
    }
  }

  /**
   * Extracts operation ID from API documentation chunk
   *
   * @param chunk - The API documentation chunk
   * @returns The extracted operation ID or null
   *
   * @private
   */
  private extractOperationId(chunk: Record<string, unknown>): string | null {
    try {
      const content = chunk.content as Array<Record<string, unknown>>
      if (!content || !Array.isArray(content)) return null

      const textContent = content
        .filter((c: Record<string, unknown>) => c.type === 'text')
        .map((c: Record<string, unknown>) => c.text as string)
        .join(' ')

      // Look for operationId in the text
      const operationIdMatch = textContent.match(
        /operationId["\s]*:["\s]*([^"\s,}]+)/i
      )
      if (operationIdMatch) {
        return operationIdMatch[1]
      }

      // Look for endpoint patterns
      const endpointMatch = textContent.match(
        /(GET|POST|PUT|DELETE)\s+([^\s]+)/i
      )
      if (endpointMatch) {
        return this.convertPathToOperationId(endpointMatch[2])
      }

      return null
    } catch (error) {
      console.warn('Failed to extract operation ID from chunk:', error)
      return null
    }
  }

  /**
   * Converts API path to operation ID
   *
   * @param path - The API path
   * @returns The operation ID
   *
   * @private
   */
  private convertPathToOperationId(path: string): string {
    // Convert path like "/3/movie/{movie_id}" to "movie-details"
    const pathParts = path.split('/').filter(Boolean)
    if (pathParts.length >= 2) {
      const resource = pathParts[1] // "movie", "person", etc.
      const action = pathParts[2] || 'details' // "credits", "similar", etc.
      return `${resource}-${action}`
    }
    return 'unknown-operation'
  }

  /**
   * Categorizes endpoint based on its functionality
   *
   * @param chunk - The API documentation chunk
   * @returns The endpoint category
   *
   * @private
   */
  private categorizeEndpoint(chunk: Record<string, unknown>): string {
    try {
      const content = chunk.content as Array<Record<string, unknown>>
      if (!content || !Array.isArray(content)) return 'unknown'

      const textContent = content
        .filter((c: Record<string, unknown>) => c.type === 'text')
        .map((c: Record<string, unknown>) => c.text as string)
        .join(' ')

      // Categorize based on content patterns
      if (textContent.includes('search') || textContent.includes('query')) {
        return 'search'
      }
      if (
        textContent.includes('details') ||
        textContent.includes('information')
      ) {
        return 'details'
      }
      if (textContent.includes('credits') || textContent.includes('cast')) {
        return 'credits'
      }
      if (
        textContent.includes('similar') ||
        textContent.includes('recommendations')
      ) {
        return 'similar'
      }
      if (textContent.includes('discover') || textContent.includes('filter')) {
        return 'discover'
      }
      if (textContent.includes('genre') || textContent.includes('category')) {
        return 'genre'
      }

      return 'other'
    } catch (error) {
      console.warn('Failed to categorize endpoint:', error)
      return 'unknown'
    }
  }
}
