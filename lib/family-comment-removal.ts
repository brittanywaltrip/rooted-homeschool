// A parent removes a comment a family viewer left on one of their memories.
//
// Comments from the family portal post instantly, with no approval, and until
// September 2026 nothing in the app could take one down: the guide told
// families to email. The rule is small and lives here, with the client passed
// in, so node --test can run it (route modules import next/server and the "@/"
// alias, which Node cannot load; see lib/family-portal-guard.ts).
//
// Ownership: the memory must belong to the signed-in parent, the same user_id
// the Memories page reads the memory with, and the comment must be on that
// memory. Anything else is a 404, the same answer a comment that does not exist
// gets, so a stranger learns nothing from the difference. The viewer is not
// told; the portal simply stops showing the comment.

export interface RemovalQuery extends PromiseLike<{ data?: unknown; error?: { message?: string } | null }> {
  eq(column: string, value: unknown): RemovalQuery;
  maybeSingle(): PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
}

export interface RemovalClient {
  from(table: string): {
    select(columns: string): RemovalQuery;
    delete(): RemovalQuery;
  };
}

export type RemovalOutcome = { status: 200 | 404 | 500 };

export async function removeFamilyComment(
  client: RemovalClient,
  args: { userId: string; memoryId: string; commentId: string },
): Promise<RemovalOutcome> {
  const { userId, memoryId, commentId } = args;
  if (!userId || !memoryId || !commentId) return { status: 404 };

  const memory = await client.from("memories").select("id, user_id").eq("id", memoryId).maybeSingle();
  if (memory.error) return { status: 500 };
  const owner = (memory.data as { user_id?: string } | null)?.user_id;
  if (!owner || owner !== userId) return { status: 404 };

  const comment = await client
    .from("memory_comments")
    .select("id")
    .eq("id", commentId)
    .eq("memory_id", memoryId)
    .maybeSingle();
  if (comment.error) return { status: 500 };
  if (!comment.data) return { status: 404 };

  const removed = await client.from("memory_comments").delete().eq("id", commentId).eq("memory_id", memoryId);
  if (removed.error) return { status: 500 };
  return { status: 200 };
}
