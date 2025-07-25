import { Button } from '@/components/ui/button'
import { ReasoningContentPartComponent } from '@assistant-ui/react'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { useState } from 'react'

export const ReasoningPreview: ReasoningContentPartComponent = ({
  text,
  status,
  // duration, // <- TODO: This needs to be added
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div className="mb-4 flex w-full flex-col gap-3 border-l-2 py-1">
      <div className="flex items-center gap-2 px-4">
        {status.type === 'running' ? (
          <span className="text-muted-foreground text-sm">Thinking...</span>
        ) : null}
        {status.type === 'complete' ? (
          <span className="text-muted-foreground text-sm">
            Thought for {'some'} seconds
            {/* you can use {duration} here like {status?.duration || 'some'} */}
          </span>
        ) : null}
        {status.type === 'incomplete' ? (
          <span className="text-muted-foreground text-sm">
            Thinking Incomplete, Reason: {status.reason}
          </span>
        ) : null}
        {status.type === 'requires-action' ? (
          <span className="text-muted-foreground text-sm">
            Thinking Requires Action, Reason: {status.reason}
          </span>
        ) : null}
        <div className="flex-grow" />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </Button>
      </div>
      {!isCollapsed && (
        <div className="px-4 text-sm text-muted-foreground whitespace-pre-line">
          {text}
        </div>
      )}
    </div>
  )
}
