import { useState, useRef, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Bot, X, Send, FileCode, Check, XCircle, Zap, Coins, ChevronDown } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useIdeStore } from '@/stores/ideStore'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { IDE_AGENT_TOOLS, executeIdeTool } from '@/lib/ideAgentTools'

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatCost(c: number): string {
  if (c >= 1) return '$' + c.toFixed(2);
  if (c >= 0.01) return '$' + c.toFixed(3);
  return '$' + c.toFixed(4);
}

interface IdeAiSidebarProps {
  serverId: string
  sshSessionId: string
  currentFile: string | null
  currentContent: string | null
  attachedFiles: { path: string; name: string }[]
  onApplyEdit: (path: string, content: string) => void
  onClearAttachment: (path: string) => void
  showDropZone?: boolean
  workingDir: string
  serverHost: string
  onOpenFile: (path: string) => void
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  isStreaming?: boolean
  isToolCall?: boolean
  toolDetails?: { name: string; path?: string }[]
  tokens?: number
  cost?: number
  model?: string
  editProposal?: { filePath: string; newContent: string; description: string }
  commandOutput?: string
}

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface ApiMessage {
  role: string
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export function IdeAiSidebar({
  serverId,
  sshSessionId,
  currentFile,
  currentContent,
  attachedFiles,
  onApplyEdit,
  onClearAttachment,
  showDropZone,
  workingDir,
  serverHost,
  onOpenFile,
}: IdeAiSidebarProps) {
  const { getSetting } = useSettingsStore()
  const { toggleAiSidebar } = useIdeStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sessionTokens, setSessionTokens] = useState(0)
  const [sessionCost, setSessionCost] = useState(0)
  const [selectedModel, setSelectedModel] = useState(getSetting('ai_model', 'deepseek/deepseek-v4-flash'))
  const [modelPickerOpen, setModelPickerOpen] = useState(false)

  const getFavoriteModels = () => {
    const active = getSetting('ai_active_models', '')
    const defaultModel = getSetting('ai_model', 'deepseek/deepseek-v4-flash')
    const list = active ? active.split(',').map((s: string) => s.trim()).filter(Boolean) : []
    if (!list.includes(defaultModel)) list.unshift(defaultModel)
    return list
  }
  const pricingRef = useRef<{ prompt: number; completion: number }>({ prompt: 0, completion: 0 })
  const modelCapRef = useRef<{ maxOutput: number; contextLength: number; supportsReasoning: boolean }>({ maxOutput: 16000, contextLength: 128000, supportsReasoning: false })
  const modelsDataRef = useRef<any[]>([])
  const [workspaceTree, setWorkspaceTree] = useState<string>('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Fetch top-level workspace structure on mount
  useEffect(() => {
    invoke<any[]>('sftp_list_dir', { sessionId: serverId, path: workingDir })
      .then((items) => {
        const tree = items
          .sort((a: any, b: any) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
          .map((i: any) => i.kind === 'directory' ? `${i.name}/` : i.name)
          .join('\n')
        setWorkspaceTree(tree)
      })
      .catch(() => {})
  }, [serverId, workingDir])

  // Fetch model pricing
  useEffect(() => {
    const model = getSetting('ai_model', 'deepseek/deepseek-v4-flash')
    fetch('https://openrouter.ai/api/v1/models')
      .then(r => r.json())
      .then(data => {
        modelsDataRef.current = data.data || []
        const m = data.data?.find((d: any) => d.id === model)
        if (m?.pricing) {
          pricingRef.current = {
            prompt: parseFloat(m.pricing.prompt) || 0,
            completion: parseFloat(m.pricing.completion) || 0,
          }
        }
        if (m) {
          const maxOut = m.top_provider?.max_completion_tokens || 16000
          modelCapRef.current = {
            maxOutput: Math.min(maxOut, 16000), // Cap at 16K like VS Code
            contextLength: m.top_provider?.context_length || m.context_length || 128000,
            supportsReasoning: m.supported_parameters?.includes('reasoning') || false,
          }
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const buildSystemPrompt = () => {
    let prompt = `You are an expert AI coding assistant integrated in a remote server IDE. You help users read, understand, and edit code on remote servers via SFTP and SSH.

## Tools Available
- read_file: Read file contents. ALWAYS read a file before editing it.
- list_directory: Browse directory structure.
- search_files: Find files by name pattern (glob).
- edit_file: Propose edits to a file. Provide the COMPLETE new file content. The user will review and accept/reject your changes.
- run_command: Execute shell commands on the remote server.

## Rules
- Be concise and direct. No unnecessary explanations.
- NEVER edit a file without reading it first.
- When using edit_file, provide the complete new content of the file (not a diff or partial).
- After proposing an edit, STOP and wait for the user to accept or reject. Do not continue with more actions.
- When the user asks about code, use read_file and list_directory to gather context first.
- Use run_command for tasks like installing packages, running tests, checking git status, etc.
- If multiple tools are needed to answer a question, call them in sequence.
- Use code blocks with language identifiers for code snippets in your responses.
- When explaining changes, be brief: what changed and why.
- IMPORTANT: Limit to max 5 file reads per turn. If you need more context, summarize what you found and ask if the user wants you to continue exploring.`

    if (currentFile) {
      prompt += `\n\n## Current Context\nUser has this file open: ${currentFile}`
      if (currentContent) {
        const lines = currentContent.split('\n')
        if (lines.length <= 100) {
          prompt += `\nFile content:\n\`\`\`\n${currentContent}\n\`\`\``
        } else {
          prompt += `\nFile has ${lines.length} lines. Use read_file if you need the full content.`
        }
      }
    }

    if (allAttached.length > 0) {
      prompt += `\n\n## Attached Files for Context\n${allAttached.map(f => `- ${f.path}`).join('\n')}\nUse read_file to read their contents when needed.`
    }

    prompt += `\n\n<context>\nThe current date is ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.
Remote server: ${serverHost}
Working directory: ${workingDir}
${workspaceTree ? `Workspace structure:\n\`\`\`\n${workspaceTree}\n\`\`\`\nThis view may be truncated. Use list_directory or search_files to explore further.` : ''}
</context>`

    return prompt
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || isLoading) return

    const apiKey = getSetting('openrouter_api_key', '')
    const model = selectedModel
    if (!apiKey) return

    // Refresh model capabilities for selected model
    const modelInfo = modelsDataRef.current.find((m: any) => m.id === model)
    if (modelInfo) {
      const maxOut = modelInfo.top_provider?.max_completion_tokens || 16000
      modelCapRef.current = {
        maxOutput: Math.min(maxOut, 16000),
        contextLength: modelInfo.top_provider?.context_length || modelInfo.context_length || 128000,
        supportsReasoning: modelInfo.supported_parameters?.includes('reasoning') || false,
      }
      if (modelInfo.pricing) {
        pricingRef.current = { prompt: parseFloat(modelInfo.pricing.prompt) || 0, completion: parseFloat(modelInfo.pricing.completion) || 0 }
      }
    }

    const userMsg: Message = { id: `user-${Date.now()}`, role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsLoading(true)
    abortRef.current = new AbortController()

    try {
      const systemPrompt = buildSystemPrompt()

      // Auto-summarize: if history is long, compress older messages into a summary
      const KEEP_RECENT = 6
      const SUMMARIZE_THRESHOLD = 20
      let historyForApi = messages.map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls: m.toolCalls,
        tool_call_id: m.toolCallId,
      }))

      if (historyForApi.length > SUMMARIZE_THRESHOLD) {
        const older = historyForApi.slice(0, historyForApi.length - KEEP_RECENT)
        const recent = historyForApi.slice(historyForApi.length - KEEP_RECENT)
        const summaryText = older
          .filter(m => m.content && m.role !== 'tool')
          .map(m => `${m.role}: ${m.content.slice(0, 100)}`)
          .join('\n')
        historyForApi = [
          { role: 'assistant' as const, content: `[Summary of earlier conversation]\n${summaryText}`, tool_calls: undefined, tool_call_id: undefined },
          ...recent,
        ]
      }

      let apiMessages: ApiMessage[] = [
        { role: 'system', content: systemPrompt },
        ...historyForApi,
        { role: 'user', content: text },
      ]

      let turn = 0
      const MAX_TOOL_TURNS = 30
      let totalToolCalls = 0
      const MAX_TOTAL_CALLS = 100

      while (turn < MAX_TOOL_TURNS && totalToolCalls < MAX_TOTAL_CALLS) {
        turn++
        console.log(`[IDE Agent] Turn ${turn}, calls: ${totalToolCalls}`)
        const streamId = `stream-${Date.now()}-${turn}`
        setMessages((prev) => [...prev, { id: streamId, role: 'assistant', content: '', isStreaming: true }])

        const response = await callOpenRouter(apiKey, model, apiMessages, abortRef.current!.signal, (chunk) => {
          setMessages((prev) => prev.map((m) => (m.id === streamId ? { ...m, content: m.content + chunk } : m)))
        }, false, modelCapRef.current.maxOutput)

        if (!response.tool_calls || response.tool_calls.length === 0) {
          const tokens = response.usage?.total_tokens
          const cost = response.usage
            ? (response.usage.prompt_tokens * pricingRef.current.prompt + response.usage.completion_tokens * pricingRef.current.completion)
            : undefined
          setMessages((prev) => prev.map((m) => (m.id === streamId ? { ...m, isStreaming: false, tokens, cost, model } : m)))
          if (tokens) setSessionTokens((t) => t + tokens)
          if (cost) setSessionCost((c) => c + cost)
          break
        }

        // Has tool calls — show tool usage, keep all bubbles
        const toolDetails = response.tool_calls.map((tc: any) => {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.function.arguments) } catch {}
          const path = (args.path || args.directory || args.filePath) as string | undefined
          return { name: tc.function.name, path }
        })
        const toolContent = response.content || ''
        setMessages((prev) => prev.map((m) => (m.id === streamId ? { ...m, content: toolContent, isStreaming: false, isToolCall: true, toolDetails } : m)))

        apiMessages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.tool_calls,
        })

        const MAX_CALLS_PER_TURN = 10
        const remaining = MAX_TOTAL_CALLS - totalToolCalls
        const callsThisTurn = Math.min(MAX_CALLS_PER_TURN, remaining)
        for (const toolCall of response.tool_calls.slice(0, callsThisTurn)) {
          let args: Record<string, unknown> = {}
          let parseError = false
          try { args = JSON.parse(toolCall.function.arguments) } catch { parseError = true }

          if (parseError || (toolCall.function.name === 'edit_file' && !args.new_content)) {
            // Tool arguments were truncated (model hit max_tokens mid-generation)
            apiMessages.push({ role: 'tool', content: '[Error: tool arguments were incomplete/truncated]', tool_call_id: toolCall.id })
            totalToolCalls++
            setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: 'assistant', content: 'Tool call failed — response was truncated. Try a simpler request or ask me to write the file in parts.', isToolCall: true }])
            continue
          }

          const result = await executeIdeTool(toolCall.function.name, args, serverId, sshSessionId)

          apiMessages.push({
            role: 'tool',
            content: result.content,
            tool_call_id: toolCall.id,
          })
          totalToolCalls++

          // Show edit proposals and command outputs in UI
          if (result.type === 'edit_proposal') {
            setMessages((prev) => [
              ...prev,
              {
                id: `edit-${Date.now()}`,
                role: 'assistant',
                content: result.content,
                editProposal: {
                  filePath: result.filePath!,
                  newContent: result.newContent!,
                  description: result.description || '',
                },
              },
            ])
            // Stop loop — wait for user to accept/reject before continuing
            setIsLoading(false)
            return
          } else if (toolCall.function.name === 'run_command') {
            setMessages((prev) => [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                role: 'assistant',
                content: '',
                commandOutput: result.content,
              },
            ])
          }
        }
        // Respond for skipped tool calls so API doesn't error
        for (const tc of response.tool_calls.slice(callsThisTurn)) {
          apiMessages.push({ role: 'tool', content: '[limit reached]', tool_call_id: tc.id })
        }
      }

      // If loop exited due to budget (not a clean break), force a final response
      console.log('[IDE Agent] Loop exited:', { turn, totalToolCalls, MAX_TOOL_TURNS, MAX_TOTAL_CALLS })
      if (turn >= MAX_TOOL_TURNS || totalToolCalls >= MAX_TOTAL_CALLS) {
        // Budget exhausted — send final request WITH tools so model can create_file
        console.log('[IDE Agent] Budget exceeded, sending final request with tools enabled.')
        apiMessages.push({ role: 'user', content: '[System: You have reached the tool call limit. Provide your final answer or create the requested file NOW.]' })
        const finalId = `stream-final-${Date.now()}`
        setMessages((prev) => [...prev, { id: finalId, role: 'assistant', content: '', isStreaming: true }])
        try {
          const finalResponse = await callOpenRouter(apiKey, model, apiMessages, abortRef.current!.signal, (chunk) => {
            setMessages((prev) => prev.map((m) => (m.id === finalId ? { ...m, content: m.content + chunk } : m)))
          }, false, modelCapRef.current.maxOutput)
          console.log('[IDE Agent] Final response:', { contentLength: finalResponse.content?.length, hasToolCalls: !!finalResponse.tool_calls })
          // If model calls create_file in final response, execute it
          if (finalResponse.tool_calls) {
            for (const tc of finalResponse.tool_calls) {
              let args: Record<string, unknown> = {}
              try { args = JSON.parse(tc.function.arguments) } catch {}
              if (tc.function.name === 'create_file' && args.content) {
                const res = await executeIdeTool('create_file', args, serverId, sshSessionId)
                setMessages((prev) => prev.map((m) => (m.id === finalId ? { ...m, content: res.content, isStreaming: false } : m)))
              }
            }
          }
          setMessages((prev) => prev.map((m) => (m.id === finalId ? { ...m, isStreaming: false } : m)))
        } catch (finalErr) {
          console.error('[IDE Agent] Final request failed:', finalErr)
          setMessages((prev) => prev.map((m) => (m.id === finalId ? { ...m, content: `Error: ${finalErr}`, isStreaming: false } : m)))
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const errMsg = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [
          ...prev.filter((m) => !m.isStreaming),
          { id: `err-${Date.now()}`, role: 'assistant', content: `Error: ${errMsg || 'Request failed'}` },
        ])
      }
    } finally {
      setMessages((prev) => prev.filter((m) => !m.isStreaming || m.content))
      setIsLoading(false)
      abortRef.current = null
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const [localAttached, setLocalAttached] = useState<{ path: string; name: string }[]>([])
  const allAttached = [...attachedFiles, ...localAttached.filter((l) => !attachedFiles.some((a) => a.path === l.path))]

  const handleClearAttachment = (path: string) => {
    setLocalAttached((prev) => prev.filter((f) => f.path !== path))
    onClearAttachment(path)
  }

  return (
    <div
      data-ide-drop-zone
      className={`w-full flex flex-col h-full bg-[#252526] border-l border-[#3c3c3c] text-[#cccccc] relative`}
    >
      {/* Drop zone placeholder */}
      {showDropZone && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0a84ff]/10 border-2 border-dashed border-[#0a84ff] rounded-lg m-2 pointer-events-none">
          <div className="flex flex-col items-center gap-1 text-[#0a84ff]">
            <FileCode className="w-6 h-6" />
            <span className="text-xs font-medium">Drop file to attach</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Bot className="w-4 h-4" />
          AI Agent
        </div>
        <button onClick={toggleAiSidebar} className="p-1 rounded hover:bg-[#3c3c3c]">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Attached files are shown in input section below */}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3" ref={scrollRef}>
        <div className="flex flex-col gap-3">
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Bot className="w-8 h-8 text-[#555] mb-3" />
              <p className="text-xs font-medium text-[#ccc] mb-1">AI Agent</p>
              <p className="text-[11px] text-[#777] mb-4 px-4">I can read, edit files, search your codebase, and run commands on the server.</p>
              <div className="flex flex-col gap-1.5 w-full px-2">
                {["Explain this file", "Find all TODO comments", "Refactor this function", "Run tests"].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); }}
                    className="w-full text-left rounded-md border border-[#3c3c3c] px-3 py-1.5 text-[11px] text-[#aaa] hover:bg-[#2a2d2e] hover:text-[#ccc] transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg) => {
            if (msg.editProposal) {
              return (
                <EditProposalCard
                  key={msg.id}
                  msgId={msg.id}
                  proposal={msg.editProposal}
                  onApply={(filePath, newContent) => {
                    onApplyEdit(filePath, newContent)
                    const filename = filePath.split('/').pop()
                    setMessages((prev) => [
                      ...prev,
                      { id: `applied-${Date.now()}`, role: 'assistant', content: `Applied to ${filename}. Review and save when ready.` },
                    ])
                  }}
                  onDismiss={(id) => setMessages((prev) => prev.filter((m) => m.id !== id))}
                />
              )
            }

            if (msg.commandOutput !== undefined) {
              return (
                <div key={msg.id} className="rounded-lg bg-[#1e1e1e] p-2 text-xs">
                  <pre className="whitespace-pre-wrap font-mono text-[#d4d4d4] overflow-x-auto">{msg.commandOutput}</pre>
                </div>
              )
            }

            return (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                    msg.isToolCall
                      ? 'bg-[#1e1e1e] border border-[#3c3c3c] text-[#888]'
                      : msg.role === 'user' ? 'bg-[#264f78] text-white' : 'bg-[#2d2d2d] text-[#cccccc]'
                  }`}
                >
                  {msg.isToolCall ? (
                    <div className="text-[11px] font-mono space-y-0.5">
                      {msg.toolDetails?.map((td, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <span className="text-[#666]">⚙ {td.name}</span>
                          {td.path && (
                            <button
                              onClick={() => onOpenFile(td.path!)}
                              className="text-[#4fc1ff] hover:underline truncate"
                            >
                              {td.path.split('/').pop()}
                            </button>
                          )}
                        </div>
                      ))}
                      {msg.content && <span className="text-[#aaa]">{msg.content}</span>}
                    </div>
                  ) : msg.role === 'assistant' ? (
                    <div className="prose prose-sm prose-invert max-w-none [&_pre]:bg-[#1e1e1e] [&_pre]:rounded [&_pre]:p-2 [&_code]:text-xs [&_p]:my-1 [&_table]:block [&_table]:overflow-x-auto [&_table]:text-xs">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                  {msg.isStreaming && !msg.content && (
                    <span className="text-xs text-[#888] italic">Thinking...</span>
                  )}
                  {msg.tokens && !msg.isToolCall && (
                    <div className="mt-1 flex items-center gap-2 text-[9px] text-[#555]">
                      {msg.model && <span>{msg.model.split('/').pop()}</span>}
                      <span className="flex items-center gap-0.5"><Zap size={8} />{formatNum(msg.tokens)}</span>
                      {msg.cost != null && msg.cost > 0 && <span className="flex items-center gap-0.5"><Coins size={8} />{formatCost(msg.cost)}</span>}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {isLoading && messages.every((m) => !m.isStreaming) && (
            <div className="flex justify-start">
              <div className="bg-[#2d2d2d] rounded-lg px-3 py-2 text-sm text-[#888] italic">Thinking...</div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[#3c3c3c] p-2">
        <div className="flex gap-1 items-end">
          <textarea
            value={input}
            onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about code..."
            rows={1}
            className="flex-1 resize-none rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-3 py-2 text-sm text-[#cccccc] placeholder:text-[#666] focus:outline-none focus:border-[#0e639c]"
            style={{ maxHeight: '120px' }}
          />
          {isLoading ? (
            <button
              onClick={() => { abortRef.current?.abort(); setIsLoading(false); }}
              className="p-2 rounded-md hover:bg-[#3c3c3c] text-red-400"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="p-2 rounded-md hover:bg-[#3c3c3c] disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center text-[10px] text-[#555]">
          <div className="relative">
            <button
              onClick={() => setModelPickerOpen(!modelPickerOpen)}
              className="flex items-center gap-0.5 hover:text-[#ccc] transition-colors"
            >
              {selectedModel.split('/').pop()}
              <ChevronDown size={9} />
            </button>
            {modelPickerOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-[200px] rounded border border-[#454545] bg-[#252526] shadow-lg z-50 py-1">
                {getFavoriteModels().map((m) => (
                  <button
                    key={m}
                    onClick={() => { setSelectedModel(m); setModelPickerOpen(false); }}
                    className={`w-full text-left px-2 py-1 text-[10px] truncate hover:bg-[#37373d] ${m === selectedModel ? 'text-[#4fc1ff]' : 'text-[#ccc]'}`}
                  >
                    {m.split('/').pop()}
                  </button>
                ))}
              </div>
            )}
          </div>
          {sessionTokens > 0 && <span className="ml-2 inline-flex items-center gap-1 text-[#666]">· <Zap size={9} />{formatNum(sessionTokens)}{sessionCost > 0 && <> · <Coins size={9} />{formatCost(sessionCost)}</>}</span>}
        </div>
        {/* Attached files chips */}
        {allAttached.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {allAttached.map((f) => (
              <span key={f.path} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-[#37373d] rounded">
                <FileCode className="w-2.5 h-2.5" />
                {f.name}
                <button onClick={() => handleClearAttachment(f.path)} className="hover:text-white">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        {/* Semi-auto attach: suggest current open file below input */}
        {currentFile && !allAttached.some(f => f.path === currentFile) && (
          <button
            onClick={() => {
              const name = currentFile.split('/').pop() || currentFile;
              setLocalAttached(prev => [...prev, { path: currentFile!, name }]);
            }}
            className="flex items-center gap-1 mt-1.5 px-2 py-0.5 text-[11px] text-[#0a84ff] hover:bg-[#0a84ff]/10 rounded w-full text-left"
          >
            <FileCode className="w-3 h-3" />
            + {currentFile.split('/').pop()}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Edit Proposal Card ─────────────────────────────────────────────────

function EditProposalCard({
  msgId,
  proposal,
  onApply,
  onDismiss,
}: {
  msgId: string
  proposal: { filePath: string; newContent: string; description: string }
  onApply: (filePath: string, newContent: string) => void
  onDismiss: (id: string) => void
}) {
  const { tabs } = useIdeStore()
  const filename = proposal.filePath.split('/').pop() || proposal.filePath

  const diffLines = useMemo(() => {
    const tab = tabs.find((t) => t.path === proposal.filePath)
    const oldLines = (tab?.content || '').split('\n')
    const newLines = proposal.newContent.split('\n')
    const changed: string[] = []
    const maxCheck = Math.max(oldLines.length, newLines.length)
    for (let i = 0; i < maxCheck && changed.length < 5; i++) {
      if (oldLines[i] !== newLines[i]) {
        if (oldLines[i] !== undefined && oldLines[i] !== newLines[i]) {
          changed.push(`- ${oldLines[i]}`)
        }
        if (newLines[i] !== undefined && newLines[i] !== oldLines[i]) {
          changed.push(`+ ${newLines[i]}`)
        }
      }
      if (changed.length >= 5) break
    }
    return changed.length > 0 ? changed : ['(no visible diff — new file or identical)']
  }, [tabs, proposal.filePath, proposal.newContent])

  return (
    <div className="rounded-lg border border-[#4c4c4c] bg-[#1e1e1e] p-3 text-xs">
      <div className="flex items-center gap-2 mb-1 text-[#569cd6]">
        <FileCode className="w-3.5 h-3.5" />
        <span className="font-medium">{filename}</span>
      </div>
      {proposal.description && <p className="text-[#aaa] mb-2">{proposal.description}</p>}
      <div className="mb-2 rounded bg-[#1a1a1a] p-2 font-mono text-[10px] leading-4 overflow-x-auto max-h-24 border border-[#333]">
        {diffLines.map((line, i) => (
          <div key={i} className={line.startsWith('+') ? 'text-[#4ec9b0]' : line.startsWith('-') ? 'text-[#f48771]' : 'text-[#888]'}>
            {line}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => onApply(proposal.filePath, proposal.newContent)}
          className="flex items-center gap-1 px-2 py-1 rounded bg-[#2ea043] hover:bg-[#3fb950] text-white text-xs"
        >
          <Check className="w-3 h-3" />
          Apply
        </button>
        <button
          onClick={() => onDismiss(msgId)}
          className="flex items-center gap-1 px-2 py-1 rounded bg-[#3c3c3c] hover:bg-[#4c4c4c] text-[#ccc] text-xs"
        >
          <XCircle className="w-3 h-3" />
          Dismiss
        </button>
      </div>
      <p className="text-[10px] text-[#666] italic">Changes will be unsaved until you ⌘S</p>
    </div>
  )
}

// ── OpenRouter streaming call ──────────────────────────────────────────

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: ApiMessage[],
  signal: AbortSignal,
  onChunk: (text: string) => void,
  noTools = false,
  maxTokens = 16000,
): Promise<{ content: string | null; tool_calls?: ToolCall[]; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content }
      if (m.tool_calls) msg.tool_calls = m.tool_calls
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
      return msg
    }),
    stream: true,
    temperature: 0.3,
    max_tokens: maxTokens,
  }
  if (!noTools) {
    body.tools = IDE_AGENT_TOOLS
    body.tool_choice = 'auto'
  }
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://badami.app',
      'X-Title': 'Badami IDE',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter error (${res.status}): ${err}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let fullContent = ''
  const toolCalls: ToolCall[] = []
  let buffer = ''
  let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta
        if (!delta) continue

        if (delta.content) {
          fullContent += delta.content
          onChunk(delta.content)
        }

        // DeepSeek reasoning_content — treat as regular content
        if (delta.reasoning_content) {
          // Skip reasoning tokens, don't show to user
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } }
            }
            if (tc.id) toolCalls[idx].id = tc.id
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments
          }
        }

        if (parsed.usage) {
          usage = parsed.usage
        }
      } catch {}
    }
  }

  return {
    content: fullContent || null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
  }
}
