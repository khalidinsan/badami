import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Plus,
  Trash2,
  Bot,
  User,
  Loader2,
  MessageSquare,
  StopCircle,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAiChat, type ChatMessage } from "@/hooks/useAiChat";
import * as aiQueries from "@/db/queries/ai";
import type { AiConversationRow } from "@/types/db";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "sonner";

export function AiChat() {
  const { getSetting } = useSettingsStore();
  const [conversations, setConversations] = useState<AiConversationRow[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedModel = getSetting("ai_model", "openai/gpt-4o-mini");
  const apiKey = getSetting("openrouter_api_key", "");

  const { messages, loading, sendMessage, loadMessages, stopGeneration, setMessages } = useAiChat(activeConvId);

  // Load conversations
  useEffect(() => {
    aiQueries.getConversations().then(setConversations);
  }, []);

  // Load messages when conversation changes
  useEffect(() => {
    if (activeConvId) {
      loadMessages(activeConvId);
    } else {
      setMessages([]);
    }
  }, [activeConvId, loadMessages, setMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleNewConversation = async () => {
    const conv = await aiQueries.createConversation({ model: selectedModel });
    setConversations((prev) => [conv, ...prev]);
    setActiveConvId(conv.id);
  };

  const handleDeleteConversation = async (id: string) => {
    await aiQueries.deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvId === id) {
      setActiveConvId(null);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    if (!apiKey) {
      toast.error("OpenRouter API key not set. Go to Settings → AI to configure.");
      return;
    }

    let convId = activeConvId;
    if (!convId) {
      const conv = await aiQueries.createConversation({ model: selectedModel, title: input.slice(0, 50) });
      setConversations((prev) => [conv, ...prev]);
      setActiveConvId(conv.id);
      convId = conv.id;
    }

    const msg = input;
    setInput("");

    try {
      await sendMessage(msg, convId, selectedModel);
      // Auto-rename conversation if it's the first message
      const conv = conversations.find((c) => c.id === convId);
      if (conv && conv.title === "New Chat") {
        await aiQueries.updateConversation(convId, { title: msg.slice(0, 50) });
        setConversations((prev) => prev.map((c) => c.id === convId ? { ...c, title: msg.slice(0, 50) } : c));
      }
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full">
      {/* Conversation sidebar */}
      {showSidebar && (
        <div className="flex w-[220px] shrink-0 flex-col border-r border-border/40 bg-card/30">
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground">Chats</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNewConversation}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-1.5 space-y-0.5">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs cursor-pointer transition-colors",
                    activeConvId === conv.id
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted/40",
                  )}
                  onClick={() => setActiveConvId(conv.id)}
                >
                  <MessageSquare className="h-3 w-3 shrink-0" />
                  <span className="flex-1 truncate">{conv.title}</span>
                  <button
                    className="shrink-0 opacity-0 group-hover:opacity-60 hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {conversations.length === 0 && (
                <p className="px-2 py-4 text-center text-[11px] text-muted-foreground/50">
                  No conversations yet
                </p>
              )}
            </div>
          </ScrollArea>
          {/* Current model indicator */}
          <div className="border-t border-border/40 px-3 py-2">
            <p className="truncate text-[10px] text-muted-foreground/60">
              Model: <span className="font-medium text-muted-foreground">{selectedModel.split("/").pop()}</span>
            </p>
          </div>
        </div>
      )}

      {/* Chat area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowSidebar(!showSidebar)}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </Button>
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Badami AI</span>
          {!apiKey && (
            <span className="ml-2 rounded bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">
              API key not set
            </span>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Bot className="h-10 w-10 mb-3 opacity-20" />
              <p className="text-sm font-medium">How can I help you?</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                I can manage your tasks, search projects, and more.
              </p>
            </div>
          )}

          {messages.filter((m) => m.role !== "tool" && m.role !== "system").map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">Thinking...</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={stopGeneration}>
                <StopCircle className="h-3 w-3 mr-1" />
                Stop
              </Button>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything... (tasks, projects, planning)"
              className="flex-1 text-sm"
              disabled={loading}
            />
            <Button
              size="icon"
              className="h-9 w-9"
              onClick={handleSend}
              disabled={loading || !input.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
        isUser ? "bg-primary/10" : "bg-muted/60",
      )}>
        {isUser ? <User className="h-3.5 w-3.5 text-primary" /> : <Bot className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <div className={cn(
        "group relative max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm",
        isUser
          ? "bg-primary text-primary-foreground"
          : "bg-muted/50 text-foreground",
      )}>
        {isUser ? (
          <div className="whitespace-pre-wrap break-words leading-relaxed">
            {message.content}
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-code:text-[12px] prose-pre:bg-black/20 prose-pre:rounded-lg prose-code:before:content-none prose-code:after:content-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {/* Copy button for assistant messages */}
        {!isUser && message.content && (
          <button
            onClick={handleCopy}
            className="absolute -bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-muted/60"
            title="Copy"
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
          </button>
        )}
      </div>
    </div>
  );
}
