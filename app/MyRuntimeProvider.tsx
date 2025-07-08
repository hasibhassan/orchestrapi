'use client'

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react'

// Custom ChatModelAdapter that streams NDJSON from /api/chat
const MyModelAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    // Call the backend, which returns an async generator of text chunks
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, stream: true }),
      signal: abortSignal,
    })
    if (!response.body) throw new Error('No response body')
    // Use the Vercel AI SDK's streamText format: async generator of text chunks
    let text = ''

    const stream = response.body
    const reader = stream.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { value, done } = await reader.read()

      if (done) break
      text += decoder.decode(value, { stream: true })

      yield {
        content: [{ type: 'text', text }],
      }
    }
  },
}

export function MyRuntimeProvider({ children }: { children: React.ReactNode }) {
  const runtime = useLocalRuntime(MyModelAdapter)

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  )
}
