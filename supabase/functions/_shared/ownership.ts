import { SupabaseClient } from './supabaseClient.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, label = 'id') {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

export function assertStorageImageId(value: string) {
  assertUuid(value, 'image id');
}

export async function requireOwnedConversation(
  supabaseClient: SupabaseClient,
  userId: string,
  conversationId: string,
) {
  assertUuid(conversationId, 'conversation id');

  const { data, error } = await supabaseClient
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    throw new Error('Conversation not found');
  }
}

export async function requireOwnedMesh(
  supabaseClient: SupabaseClient,
  userId: string,
  conversationId: string,
  meshId: string,
) {
  assertUuid(meshId, 'mesh id');
  assertUuid(conversationId, 'conversation id');

  const { data, error } = await supabaseClient
    .from('meshes')
    .select('*')
    .eq('id', meshId)
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .maybeSingle();

  if (error || !data) {
    throw new Error('Mesh not found');
  }

  return data;
}

export async function requireOwnedImageIds(
  supabaseClient: SupabaseClient,
  userId: string,
  conversationId: string,
  imageIds: string[] | undefined,
) {
  if (!imageIds || imageIds.length === 0) return;

  imageIds.forEach(assertStorageImageId);

  const { data, error } = await supabaseClient
    .from('images')
    .select('id')
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .in('id', imageIds);

  if (error || !data || data.length !== imageIds.length) {
    throw new Error('Image not found');
  }
}
