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

    // 1. Show user message IMMEDIATELY (optimistic)
    const tempUserId = `user-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempUserId, role: "user", content }]);
    setLoading(true);
    abortRef.current = new AbortController();

    try {
      // 2. Save to DB + get context (parallel, non-blocking for UI)
      const [userMsg, conv] = await Promise.all([
        aiQueries.createMessage({ conversation_id: convId, role: "user", content }),
        aiQueries.getConversationById(convId),
      ]);
      setMessages((prev) => prev.map((m) => m.id === tempUserId ? { ...m, id: userMsg.id } : m));

      const systemPrompt = conv?.system_prompt || DEFAULT_SYSTEM_PROMPT;
      const history = await aiQueries.getMessages(convId);
      let apiMessages: OpenRouterMessage[] = [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
          tool_call_id: m.tool_call_id ?? undefined,
        })),
      ];

      // ── Multi-turn tool-use loop ──────────────────────────────────
      // AI can chain multiple tool calls before final answer.
      // We keep calling until response has no more tool_calls.
      const MAX_TOOL_TURNS = 10;
      let turn = 0;

      while (turn < MAX_TOOL_TURNS) {
        turn++;

        const streamId = `stream-${Date.now()}-${turn}`;
        setMessages((prev) => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true }]);

        const response = await callOpenRouterStreaming(
          apiKey, selectedModel, apiMessages, abortRef.current!.signal,
          (chunk) => {
            setMessages((prev) =>
              prev.map((m) => m.id === streamId ? { ...m, content: m.content + chunk } : m),
            );
          },
        );

        // No tool calls — this is the final answer
        if (!response.tool_calls || response.tool_calls.length === 0) {
          setMessages((prev) =>
            prev.map((m) => m.id === streamId ? { ...m, isStreaming: false } : m),
          );
          await aiQueries.createMessage({
            conversation_id: convId,
            role: "assistant",
            content: response.content || "",
            tokens_used: response.tokens,
          });
          break;
        }

        // Has tool calls — show "using tools" indicator with names, execute, then loop
        const toolNames = response.tool_calls.map((tc) => `\`${tc.function.name}\``).join(", ");
        const toolIndicator = response.content
          ? `${response.content}\n\n🔧 Menggunakan tools: ${toolNames}`
          : `🔧 Menggunakan tools: ${toolNames}`;

        setMessages((prev) =>
          prev.map((m) => m.id === streamId
            ? { ...m, content: toolIndicator, isStreaming: false }
            : m),
        );

        await aiQueries.createMessage({
          conversation_id: convId,
          role: "assistant",
          content: response.content || "",
          tool_calls: JSON.stringify(response.tool_calls),
        });

        // Execute all tool calls
        for (const toolCall of response.tool_calls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(toolCall.function.arguments); } catch {}
          const result = await executeTool(toolCall.function.name, args);
          await aiQueries.createMessage({
            conversation_id: convId,
            role: "tool",
            content: result,
            tool_call_id: toolCall.id,
          });
        }

        // Remove the tool-call placeholder bubble (was just an indicator)
        setMessages((prev) => prev.filter((m) => m.id !== streamId));

        // Rebuild API messages for next turn
        const updatedHistory = await aiQueries.getMessages(convId);
        apiMessages = [
          { role: "system", content: systemPrompt },
          ...updatedHistory.map((m) => ({
            role: m.role,
            content: m.content,
            tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
            tool_call_id: m.tool_call_id ?? undefined,
          })),
        ];
      }

      if (turn >= MAX_TOOL_TURNS) {
        console.warn("[ai] Max tool-use turns reached");
      }
    } catch (err) {
      // Remove streaming placeholders on error
      setMessages((prev) => prev.filter((m) => !m.isStreaming));
      if ((err as Error).name !== "AbortError") {
        throw err;
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [getSetting]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setMessages((prev) => prev.map((m) => m.isStreaming ? { ...m, isStreaming: false } : m));
  }, []);

  return { messages, loading, sendMessage, loadMessages, stopGeneration, setMessages };
}

// ── OpenRouter streaming API call ───────────────────────────────────

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

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let fullContent = "";
  const toolCalls: ToolCall[] = [];
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

        if (delta.content) {
          fullContent += delta.content;
          onChunk(delta.content);
        }

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

        if (parsed.usage?.total_tokens) {
          tokens = parsed.usage.total_tokens;
        }
      } catch {
        // skip malformed
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
