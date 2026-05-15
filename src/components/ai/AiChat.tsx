import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Plus,
  Trash2,
  Bot,
  User,
  MessageSquare,
  StopCircle,
  Copy,
  Check,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, [messages]);

  // Focus input after response completes
  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus();
    }
  }, [loading]);

  const handleNewConversation = async () => {
    const conv = await aiQueries.createConversation({ model: selectedModel });
    setConversations((prev) => [conv, ...prev]);
    setActiveConvId(conv.id);
    setInput("");
  };

  const handleDeleteConversation = async (id: string) => {
    await aiQueries.deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvId === id) {
      setActiveConvId(null);
      setMessages([]);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    if (!apiKey) {
      toast.error("OpenRouter API key not set. Go to Settings → AI to configure.");
      return;
    }

    const msg = input.trim();
    setInput("");

    // Auto-resize textarea back
    if (inputRef.current) inputRef.current.style.height = "auto";

    // Create conversation if needed (but don't block UI)
    let convId = activeConvId;
    if (!convId) {
      const conv = await aiQueries.createConversation({ model: selectedModel, title: msg.slice(0, 50) });
      setConversations((prev) => [conv, ...prev]);
      setActiveConvId(conv.id);
      convId = conv.id;
    } else {
      // Auto-rename if still "New Chat"
      const conv = conversations.find((c) => c.id === convId);
      if (conv && conv.title === "New Chat") {
        aiQueries.updateConversation(convId, { title: msg.slice(0, 50) });
        setConversations((prev) => prev.map((c) => c.id === convId ? { ...c, title: msg.slice(0, 50) } : c));
      }
    }

    try {
      await sendMessage(msg, convId, selectedModel);
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

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
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
          {loading && (
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3 animate-pulse text-primary" />
              Generating...
            </span>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Bot className="h-12 w-12 mb-4 opacity-15" />
              <p className="text-sm font-medium">Ada yang bisa dibantu?</p>
              <p className="text-xs text-muted-foreground/60 mt-1 text-center max-w-[280px]">
                Aku bisa bantu kelola tasks, cari project, lihat planning, dan lainnya.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {["Ada task overdue?", "List semua project", "Buatkan task baru"].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); inputRef.current?.focus(); }}
                    className="rounded-full border border-border/60 px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.filter((m) => m.role !== "tool" && m.role !== "system").map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Typing indicator — only show when loading AND no streaming content visible */}
          {loading && !messages.some((m) => m.isStreaming && m.content) && (
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/60">
                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="rounded-xl bg-muted/50 px-4 py-3">
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border/40 px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ketik pesan... (Enter kirim, Shift+Enter baris baru)"
              className="flex-1 resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/40 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-50"
              rows={1}
              style={{ maxHeight: "120px" }}
              disabled={loading}
            />
            {loading ? (
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 shrink-0"
                onClick={stopGeneration}
                title="Stop"
              >
                <StopCircle className="h-4 w-4 text-destructive" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={handleSend}
                disabled={!input.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
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
        message.isStreaming && "animate-pulse-subtle",
      )}>
        {isUser ? (
          <div className="whitespace-pre-wrap break-words leading-relaxed">
            {message.content}
          </div>
        ) : message.content ? (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-code:text-[12px] prose-pre:bg-black/20 prose-pre:rounded-lg prose-code:before:content-none prose-code:after:content-none prose-table:text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        ) : null}

        {/* Copy button for assistant messages */}
        {!isUser && message.content && !message.isStreaming && (
          <button
            onClick={handleCopy}
            className="absolute -bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-md bg-background border border-border/60 p-1 shadow-sm hover:bg-muted/60"
            title="Copy"
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
          </button>
        )}
      </div>
    </div>
  );
}
