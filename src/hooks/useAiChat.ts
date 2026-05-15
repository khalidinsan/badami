import { useState, useCallback, useRef } from "react";
import { AI_TOOLS, executeTool } from "@/lib/aiTools";
import * as aiQueries from "@/db/queries/ai";
import type { AiMessageRow } from "@/types/db";
import { useSettingsStore } from "@/stores/settingsStore";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  isStreaming?: boolean;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenRouterMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_SYSTEM_PROMPT = `Kamu adalah Badami AI, asisten cerdas yang terintegrasi di dalam aplikasi Badami.

## Tentang Badami
Badami adalah aplikasi desktop produktivitas all-in-one yang dibangun dengan Tauri v2 + React. Fitur utamanya:
- **Projects & Pages** — Manajemen proyek dengan editor rich-text (Notion-like)
- **Tasks** — Task management dengan list, tree, Kanban board, recurring tasks, reminders
- **Daily Planning** — Kalender harian, drag-to-schedule, agenda
- **Today Window** — Floating sticky note dengan Pomodoro timer
- **Server Management** — SSH terminal, SFTP/FTP file manager
- **Credential Vault** — Penyimpanan kredensial terenkripsi AES-256-GCM, TOTP, password generator
- **REST API Tool** — Request builder, collections, environments
- **Database Client** — Koneksi MySQL/PostgreSQL/SQLite, query editor, table viewer, ER diagram
- **AI Chat** — Kamu! Asisten AI yang bisa mengakses dan mengelola data di aplikasi

## Kemampuanmu
Kamu punya akses ke tools untuk:
- Melihat dan mencari projects, tasks, pages
- Membuat dan mengupdate tasks
- Melihat planning hari ini
- Melihat daftar servers dan credentials (tanpa secrets)
- Melihat daftar koneksi database

## Aturan
- Bahasa utamamu adalah **Bahasa Indonesia**. Jawab dalam Bahasa Indonesia kecuali user bicara dalam bahasa lain.
- Jawab dengan singkat, jelas, dan to the point.
- Gunakan tools yang tersedia saat user minta informasi atau aksi terkait data di aplikasi.
- Format response dalam markdown jika perlu (list, bold, code block).
- Jangan expose data sensitif (password, secret key, dll).
- Bersikap ramah dan helpful seperti teman kerja.`;

export function useAiChat(_conversationId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { getSetting } = useSettingsStore();

  const loadMessages = useCallback(async (convId: string) => {
    const rows = await aiQueries.getMessages(convId);
    setMessages(rows.map(rowToMessage));
  }, []);

  const sendMessage = useCallback(async (content: string, convId: string, model?: string) => {
    const apiKey = getSetting("openrouter_api_key", "");
    if (!apiKey) {
      throw new Error("OpenRouter API key not configured. Go to Settings to add it.");
    }

    const selectedModel = model || getSetting("ai_model", "openai/gpt-4o-mini");
    const conv = await aiQueries.getConversationById(convId);
    const systemPrompt = conv?.system_prompt || DEFAULT_SYSTEM_PROMPT;

    // Save user message
    const userMsg = await aiQueries.createMessage({
      conversation_id: convId,
      role: "user",
      content,
    });
    const userChatMsg: ChatMessage = { id: userMsg.id, role: "user", content };
    setMessages((prev) => [...prev, userChatMsg]);

    // Build message history for API
    const history = await aiQueries.getMessages(convId);
    const apiMessages: OpenRouterMessage[] = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
        tool_call_id: m.tool_call_id ?? undefined,
      })),
    ];

    setLoading(true);
    abortRef.current = new AbortController();

    try {
      // First call — might return tool_calls
      const streamingMsgId = `streaming-${Date.now()}`;
      setMessages((prev) => [...prev, { id: streamingMsgId, role: "assistant", content: "", isStreaming: true }]);

      const response = await callOpenRouterStreaming(
        apiKey,
        selectedModel,
        apiMessages,
        abortRef.current.signal,
        (chunk) => {
          setMessages((prev) =>
            prev.map((m) => m.id === streamingMsgId ? { ...m, content: m.content + chunk } : m),
          );
        },
      );

      // Remove streaming placeholder
      setMessages((prev) => prev.filter((m) => m.id !== streamingMsgId));

      // Handle tool calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        // Save assistant message with tool calls
        await aiQueries.createMessage({
          conversation_id: convId,
          role: "assistant",
          content: response.content || "",
          tool_calls: JSON.stringify(response.tool_calls),
        });

        // Execute each tool call
        for (const toolCall of response.tool_calls) {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeTool(toolCall.function.name, args);
          await aiQueries.createMessage({
            conversation_id: convId,
            role: "tool",
            content: result,
            tool_call_id: toolCall.id,
          });
        }

        // Second call with tool results — stream this one
        const updatedHistory = await aiQueries.getMessages(convId);
        const updatedApiMessages: OpenRouterMessage[] = [
          { role: "system", content: systemPrompt },
          ...updatedHistory.map((m) => ({
            role: m.role,
            content: m.content,
            tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
            tool_call_id: m.tool_call_id ?? undefined,
          })),
        ];

        const finalMsgId = `streaming-final-${Date.now()}`;
        setMessages((prev) => [...prev, { id: finalMsgId, role: "assistant", content: "", isStreaming: true }]);

        const finalResponse = await callOpenRouterStreaming(
          apiKey,
          selectedModel,
          updatedApiMessages,
          abortRef.current.signal,
          (chunk) => {
            setMessages((prev) =>
              prev.map((m) => m.id === finalMsgId ? { ...m, content: m.content + chunk } : m),
            );
          },
        );

        setMessages((prev) => prev.filter((m) => m.id !== finalMsgId));

        await aiQueries.createMessage({
          conversation_id: convId,
          role: "assistant",
          content: finalResponse.content || "",
          tokens_used: finalResponse.tokens,
        });

        await loadMessages(convId);
      } else {
        // No tool calls — save the streamed response
        await aiQueries.createMessage({
          conversation_id: convId,
          role: "assistant",
          content: response.content || "",
          tokens_used: response.tokens,
        });

        await loadMessages(convId);
      }
    } catch (err) {
      // Remove any streaming placeholders
      setMessages((prev) => prev.filter((m) => !m.isStreaming));
      if ((err as Error).name !== "AbortError") {
        throw err;
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [getSetting, loadMessages]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    // Keep whatever was streamed so far
    setMessages((prev) => prev.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m));
  }, []);

  return {
    messages,
    loading,
    sendMessage,
    loadMessages,
    stopGeneration,
    setMessages,
  };
}

// ── OpenRouter API call with streaming ──────────────────────────────

async function callOpenRouterStreaming(
  apiKey: string,
  model: string,
  messages: OpenRouterMessage[],
  signal: AbortSignal,
  onChunk: (text: string) => void,
): Promise<{ content: string | null; tool_calls?: ToolCall[]; tokens?: number }> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://badami.app",
      "X-Title": "Badami",
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        return msg;
      }),
      tools: AI_TOOLS,
      tool_choice: "auto",
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error (${res.status}): ${err}`);
  }

  // Parse SSE stream
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let fullContent = "";
  let toolCalls: ToolCall[] = [];
  let tokens: number | undefined;
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        // Content streaming
        if (delta.content) {
          fullContent += delta.content;
          onChunk(delta.content);
        }

        // Tool calls accumulation
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id || "", type: "function", function: { name: "", arguments: "" } };
            }
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }

        // Usage info (sometimes in the last chunk)
        if (parsed.usage?.total_tokens) {
          tokens = parsed.usage.total_tokens;
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  return {
    content: fullContent || null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    tokens,
  };
}

function rowToMessage(row: AiMessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role as ChatMessage["role"],
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    toolCallId: row.tool_call_id ?? undefined,
  };
}
