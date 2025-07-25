import { HistoryRow, ThreadRow } from './types'

// Define a minimal interface for the agent to avoid circular dependencies
interface AgentInterface {
  sql<T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>
}

// Extend the interface to match the actual agent implementation
interface AgentWithEnv extends AgentInterface {
  env: {
    AI: unknown
    TMDB_API_KEY: string
    TMDB_API_TOKEN: string
  }
}

/**
 * Service for managing database operations
 *
 * This service handles all database interactions including conversation
 * history storage, thread management, and data persistence.
 */
export class DatabaseService {
  /**
   * Creates a new database service instance
   *
   * @param agent - The agent instance that provides database access
   */
  constructor(private agent: AgentWithEnv) {}

  /**
   * Initializes the database tables
   *
   * Creates the necessary tables for storing conversation history
   * and thread metadata if they don't already exist.
   *
   * @example
   * ```typescript
   * const dbService = new DatabaseService(agent)
   * await dbService.initialize()
   * ```
   */
  async initialize() {
    await this.agent.sql`CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      threadId TEXT,
      role TEXT,
      content TEXT,
      timestamp INTEGER,
      trace TEXT
    )`
    await this.agent.sql`CREATE TABLE IF NOT EXISTS threads (
      threadId TEXT PRIMARY KEY,
      title TEXT,
      lastUpdated INTEGER
    )`
  }

  /**
   * Inserts a conversation turn into the database
   *
   * Stores a single message or response in the conversation history
   * with optional trace information for debugging.
   *
   * @param turn - The conversation turn to insert
   * @returns Promise that resolves when the turn is inserted
   *
   * @example
   * ```typescript
   * await dbService.insertTurn({
   *   threadId: 'thread-123',
   *   role: 'user',
   *   content: 'Find action movies',
   *   timestamp: Date.now()
   * })
   * ```
   */
  async insertTurn(turn: Omit<HistoryRow, 'id'> & { id?: string }) {
    const id = turn.id || crypto.randomUUID()
    await this.agent
      .sql`INSERT INTO history (id, threadId, role, content, timestamp, trace)
      VALUES (${id}, ${turn.threadId}, ${turn.role}, ${JSON.stringify(
      turn.content
    )}, ${turn.timestamp}, ${turn.trace ? JSON.stringify(turn.trace) : null})`
  }

  /**
   * Retrieves the complete conversation history for a thread
   *
   * Fetches all messages and responses for a specific conversation
   * thread, ordered by timestamp.
   *
   * @param threadId - The ID of the thread to retrieve
   * @returns Promise containing the conversation history
   *
   * @example
   * ```typescript
   * const conversation = await dbService.getConversation('thread-123')
   * ```
   */
  async getConversation(threadId: string): Promise<HistoryRow[]> {
    return await this.agent
      .sql<HistoryRow>`SELECT * FROM history WHERE threadId = ${threadId} ORDER BY timestamp ASC`
  }

  /**
   * Creates or updates a thread in the database
   *
   * Inserts a new thread or updates an existing one with new metadata.
   *
   * @param thread - The thread data to insert or update
   * @returns Promise that resolves when the thread is saved
   *
   * @example
   * ```typescript
   * await dbService.upsertThread({
   *   threadId: 'thread-123',
   *   title: 'Movie Search Conversation',
   *   lastUpdated: Date.now()
   * })
   * ```
   */
  async upsertThread(thread: ThreadRow) {
    await this.agent
      .sql`INSERT OR REPLACE INTO threads (threadId, title, lastUpdated)
      VALUES (${thread.threadId}, ${thread.title}, ${thread.lastUpdated})`
  }

  /**
   * Retrieves a specific thread by ID
   *
   * Fetches the metadata for a single thread.
   *
   * @param threadId - The ID of the thread to retrieve
   * @returns Promise containing the thread data or undefined if not found
   *
   * @example
   * ```typescript
   * const thread = await dbService.getThread('thread-123')
   * ```
   */
  async getThread(threadId: string): Promise<ThreadRow | undefined> {
    const rows = await this.agent
      .sql<ThreadRow>`SELECT * FROM threads WHERE threadId = ${threadId} LIMIT 1`
    return rows[0]
  }

  /**
   * Lists all threads in the database
   *
   * Retrieves all conversation threads, ordered by last updated time.
   *
   * @returns Promise containing all thread metadata
   *
   * @example
   * ```typescript
   * const threads = await dbService.listThreads()
   * ```
   */
  async listThreads(): Promise<ThreadRow[]> {
    return await this.agent
      .sql<ThreadRow>`SELECT * FROM threads ORDER BY lastUpdated DESC`
  }
}
