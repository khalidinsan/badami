import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";
import type { AiConversationRow, AiMessageRow } from "@/types/db";

// ─── Conversations ──────────────────────────────────────────────────

export async function getConversations(): Promise<AiConversationRow[]> {
  return db
    .selectFrom("ai_conversations")
    .selectAll()
    .orderBy("updated_at", "desc")
    .execute();
}

export async function getConversationById(id: string): Promise<AiConversationRow | undefined> {
  return db
    .selectFrom("ai_conversations")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

export async function createConversation(data: {
  title?: string;
  model?: string;
  system_prompt?: string | null;
}): Promise<AiConversationRow> {
  const id = uuidv4();
  const ts = now();
  await db
    .insertInto("ai_conversations")
    .values({
      id,
      title: data.title ?? "New Chat",
      model: data.model ?? "openai/gpt-4o-mini",
      system_prompt: data.system_prompt ?? null,
      created_at: ts,
      updated_at: ts,
    })
    .execute();
  return (await getConversationById(id))!;
}

export async function updateConversation(
  id: string,
  data: { title?: string; model?: string; system_prompt?: string | null },
): Promise<void> {
  await db
    .updateTable("ai_conversations")
    .set({ ...data, updated_at: now() })
    .where("id", "=", id)
    .execute();
}

export async function deleteConversation(id: string): Promise<void> {
  await db.deleteFrom("ai_messages").where("conversation_id", "=", id).execute();
  await db.deleteFrom("ai_conversations").where("id", "=", id).execute();
}

// ─── Messages ───────────────────────────────────────────────────────

export async function getMessages(conversationId: string): Promise<AiMessageRow[]> {
  return db
    .selectFrom("ai_messages")
    .selectAll()
    .where("conversation_id", "=", conversationId)
    .orderBy("created_at", "asc")
    .execute();
}

export async function createMessage(data: {
  conversation_id: string;
  role: string;
  content: string;
  tool_calls?: string | null;
  tool_call_id?: string | null;
  tokens_used?: number | null;
}): Promise<AiMessageRow> {
  const id = uuidv4();
  const ts = now();
  await db
    .insertInto("ai_messages")
    .values({
      id,
      conversation_id: data.conversation_id,
      role: data.role,
      content: data.content,
      tool_calls: data.tool_calls ?? null,
      tool_call_id: data.tool_call_id ?? null,
      tokens_used: data.tokens_used ?? null,
      created_at: ts,
    })
    .execute();

  // Update conversation's updated_at
  await db
    .updateTable("ai_conversations")
    .set({ updated_at: ts })
    .where("id", "=", data.conversation_id)
    .execute();

  return { id, ...data, tool_calls: data.tool_calls ?? null, tool_call_id: data.tool_call_id ?? null, tokens_used: data.tokens_used ?? null, created_at: ts };
}

export async function updateMessage(id: string, content: string): Promise<void> {
  await db
    .updateTable("ai_messages")
    .set({ content })
    .where("id", "=", id)
    .execute();
}

export async function deleteMessage(id: string): Promise<void> {
  await db.deleteFrom("ai_messages").where("id", "=", id).execute();
}
