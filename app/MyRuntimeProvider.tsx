'use client'

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadAssistantContentPart,
} from '@assistant-ui/react'

const MyModelAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, stream: true }),
      signal: abortSignal,
    })

    if (!response.body) {
      throw new Error('No response body from backend')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentResponse = ''
    const reasoningSteps: string[] = []
    let toolCallId = 0
    const contentParts: ThreadAssistantContentPart[] = []

    // Read and yield each NDJSON line as a message
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()!

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let parsed

        try {
          parsed = JSON.parse(trimmed)
        } catch {
          console.warn('Failed to parse line as JSON:', trimmed)
          continue
        }
        console.log('Parsed backend line:', parsed)

        // Handle different message types from our agent
        if (parsed.type === 'content' && typeof parsed.text === 'string') {
          // This is the actual content we want to stream
          currentResponse += parsed.text
          console.log('Adding main response text:', parsed.text)
          // Update or add text content part - this should be the main response
          const textPartIndex = contentParts.findIndex(
            (part) => part.type === 'text'
          )
          if (textPartIndex >= 0) {
            ;(contentParts[textPartIndex] as unknown as { text: string }).text =
              currentResponse
          } else {
            contentParts.push({ type: 'text', text: currentResponse })
          }
        } else if (
          parsed.type === 'status' &&
          typeof parsed.message === 'string'
        ) {
          // Status updates - add to reasoning
          console.log('Status:', parsed.message)
          reasoningSteps.push(`🔄 ${parsed.message}`)
          // Update reasoning content part
          const reasoningPartIndex = contentParts.findIndex(
            (part) => part.type === 'reasoning'
          )
          if (reasoningPartIndex >= 0) {
            ;(
              contentParts[reasoningPartIndex] as unknown as { text: string }
            ).text = reasoningSteps.join('\n')
          } else {
            contentParts.push({
              type: 'reasoning',
              text: reasoningSteps.join('\n'),
            })
          }
        } else if (parsed.type === 'trace') {
          // Reasoning traces - add to reasoning steps
          console.log('Trace:', parsed.trace)
          if (
            parsed.trace?.step === 'documentation_search' &&
            parsed.trace?.data
          ) {
            const docs = parsed.trace.data
              .slice(0, 2)
              .map(
                (doc: { text: string }) =>
                  `📚 Found: ${doc.text.slice(0, 100)}...`
              )
              .join('\n')
            reasoningSteps.push(docs)
            // Update reasoning content part
            const reasoningPartIndex = contentParts.findIndex(
              (part) => part.type === 'reasoning'
            )
            if (reasoningPartIndex >= 0) {
              ;(
                contentParts[reasoningPartIndex] as unknown as { text: string }
              ).text = reasoningSteps.join('\n')
            } else {
              contentParts.push({
                type: 'reasoning',
                text: reasoningSteps.join('\n'),
              })
            }
          } else if (parsed.trace?.step === 'execution_plan') {
            const plan = parsed.trace.data
            reasoningSteps.push(
              `🧠 Plan: ${plan.reasoning}\n📋 Steps: ${plan.steps}`
            )
            // Update reasoning content part
            const reasoningPartIndex = contentParts.findIndex(
              (part) => part.type === 'reasoning'
            )
            if (reasoningPartIndex >= 0) {
              ;(
                contentParts[reasoningPartIndex] as unknown as { text: string }
              ).text = reasoningSteps.join('\n')
            } else {
              contentParts.push({
                type: 'reasoning',
                text: reasoningSteps.join('\n'),
              })
            }
          } else if (parsed.trace?.step === 'execution_complete') {
            const steps = parsed.trace.data
              ?.map(
                (step: { status: string; step: string }) =>
                  `${step.status === 'completed' ? '✅' : '❌'} ${step.step}`
              )
              .join('\n')
            reasoningSteps.push(`⚡ Execution:\n${steps}`)
            // Update reasoning content part
            const reasoningPartIndex = contentParts.findIndex(
              (part) => part.type === 'reasoning'
            )
            if (reasoningPartIndex >= 0) {
              ;(
                contentParts[reasoningPartIndex] as unknown as { text: string }
              ).text = reasoningSteps.join('\n')
            } else {
              contentParts.push({
                type: 'reasoning',
                text: reasoningSteps.join('\n'),
              })
            }
          } else if (parsed.trace?.step === 'tool_call' && parsed.trace?.data) {
            // Tool calls for API operations
            const toolCall = parsed.trace.data
            toolCallId++
            console.log('Adding tool call:', toolCall)
            // Add tool call content part
            contentParts.push({
              type: 'tool-call',
              toolCallId: `tool-${toolCallId}`,
              toolName: toolCall.tool || 'api_call',
              args: toolCall.args || {},
              argsText: JSON.stringify(toolCall.args || {}, null, 2),
              result: toolCall.result,
              isError: toolCall.status === 'error',
            })
          }
        } else if (
          parsed.type === 'error' &&
          typeof parsed.message === 'string'
        ) {
          // Error messages should be displayed as text content, not reasoning
          console.error('Agent error:', parsed.message)
          const errorMessage = `❌ Error: ${parsed.message}`

          // Add error as text content
          const textPartIndex = contentParts.findIndex(
            (part) => part.type === 'text'
          )
          if (textPartIndex >= 0) {
            ;(contentParts[textPartIndex] as unknown as { text: string }).text =
              errorMessage
          } else {
            contentParts.push({ type: 'text', text: errorMessage })
          }
        } else if (parsed.type === 'done') {
          // End of stream
          console.log('Agent completed')
        }

        // Yield the current state of all content parts
        if (contentParts.length > 0) {
          console.log('Yielding content parts:', contentParts)
          yield {
            content: contentParts,
            status: { type: 'running' },
          }
        }
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
