import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { fal } from 'npm:@fal-ai/client';
import { GoogleGenAI } from 'npm:@google/genai';
import Anthropic from 'npm:@anthropic-ai/sdk';
import {
  generateImageWithFalFlux,
  generateImageWithGeminiMultiTurn,
  generateImageWithGeminiFlash,
  generateImageWithGeminiFlashEdit,
} from '../_shared/imageGen.ts';
import { Model, MeshFileType } from '@shared/types.ts';
import {
  getServiceRoleSupabaseClient,
  SupabaseClient,
} from '../_shared/supabaseClient.ts';
import { reformatSignedUrl } from '../_shared/messageUtils.ts';
import { billing, BillingClientError } from '../_shared/billingClient.ts';
import { initSentry, logError, logApiError } from '../_shared/sentry.ts';
import { Buffer } from 'node:buffer';

const MESH_TOKEN_COST = 30;

// Initialize Sentry for error logging
initSentry();

// Constants
const TEXTURELESS_MAX_POLYGONS = 50000;

const DEBUG_LOGS =
  Deno.env.get('ENVIRONMENT') === 'local' ||
  Deno.env.get('DEBUG_LOGS') === 'true';
const debugLog = (...args: unknown[]) => {
  if (DEBUG_LOGS) console.log(...args);
};

// Helper function to get a signed URL for an image, with existence verification
async function getSignedImageUrl(
  supabaseClient: SupabaseClient,
  userId: string,
  conversationId: string,
  imageIdOrUrl: string,
): Promise<string> {
  // If it's already a URL, return it as-is
  if (imageIdOrUrl.startsWith('http')) {
    return imageIdOrUrl;
  }

  // It's a filename/ID, verify the image exists and get a signed URL
  const imagePath = `${userId}/${conversationId}/${imageIdOrUrl}`;
  debugLog(`Checking if image exists at path: ${imagePath}`);

  // First verify the image exists
  const existsResult = await supabaseClient.storage
    .from('images')
    .exists(imagePath);

  if (existsResult.error) {
    debugLog(`Failed to check image existence: ${existsResult.error.message}`);
    throw new Error(
      `Failed to check image existence: ${existsResult.error.message}`,
    );
  }

  if (!existsResult.data) {
    debugLog(`Image not found at path: ${imagePath}`);
    throw new Error(`Image not found: ${imageIdOrUrl}`);
  }

  // Create a signed URL for the image (external APIs need publicly accessible URLs)
  // 1 hour expiry is sufficient for image processing operations
  const { data: signedUrlData, error: signedUrlError } =
    await supabaseClient.storage
      .from('images')
      .createSignedUrl(imagePath, 60 * 60);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    debugLog(`Failed to create signed URL: ${signedUrlError?.message}`);
    throw new Error(
      `Failed to create signed URL for image: ${signedUrlError?.message}`,
    );
  }

  // Use reformatSignedUrl to ensure the URL is properly formatted for external access
  return reformatSignedUrl(signedUrlData.signedUrl);
}

// Helper function to get the most recent mesh preview from the conversation
async function getRecentMeshPreview(
  supabaseClient: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<string | null> {
  try {
    // Get the most recent mesh from this conversation
    const { data: recentMesh, error: meshError } = await supabaseClient
      .from('meshes')
      .select('id')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (meshError || !recentMesh) {
      return null;
    }

    // Check if a preview exists for this mesh
    const { data: previewFiles, error: previewError } =
      await supabaseClient.storage
        .from('images')
        .list(`${userId}/${conversationId}`, {
          search: `preview-${recentMesh.id}`,
          limit: 1,
        });

    if (previewError || !previewFiles || previewFiles.length === 0) {
      return null;
    }

    return previewFiles[0].name;
  } catch (error) {
    console.warn('Failed to get recent mesh preview:', error);
    return null;
  }
}

fal.config({
  credentials: Deno.env.get('FAL_KEY') ?? '',
});

// Initialize Google GenAI client
const googleGenAI = new GoogleGenAI({
  apiKey: Deno.env.get('GOOGLE_API_KEY') ?? '',
});

const supabaseClient = getServiceRoleSupabaseClient();

// Initialize Anthropic client for fun message generation
const anthropic = new Anthropic({
  apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '',
});

// Helper function to stream message data to the client
function streamMessage(
  controller: ReadableStreamDefaultController,
  message: Record<string, unknown>,
) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(message) + '\n'));
}

// System prompt for generating fun upscale messages
const upscaleSystemPrompt = `You are Adam, a fun, playful, nerdy assistant who creates 3D meshes. 
You're about to upscale a mesh to production quality. 
Generate a SHORT (1 sentence max), enthusiastic message about starting the upscale.
Be quirky and excited! Use wordplay or puns if appropriate.
Do NOT use quotes around your response.`;

Deno.serve(async (req) => {
  try {
    debugLog('=== DENO.SERVE MESH FUNCTION ENTRY POINT ===');
    debugLog('Mesh function called', {
      method: req.method,
      url: req.url,
      timestamp: new Date().toISOString(),
    });

    if (req.method === 'OPTIONS') {
      console.log('=== HANDLING OPTIONS REQUEST ===');
      return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      console.log('=== METHOD NOT ALLOWED ===', req.method);
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Authenticate user using bearer token
    debugLog('=== AUTHENTICATING USER ===');
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    debugLog('Auth header present:', !!authHeader);
    const { data: userData, error: userError } =
      await supabaseClient.auth.getUser(token);

    if (!userData.user) {
      logError(new Error('No user found in token'), {
        functionName: 'mesh',
        statusCode: 401,
      });
      return new Response(
        JSON.stringify({ error: { message: 'Unauthorized' } }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (userError) {
      logError(userError, {
        functionName: 'mesh',
        statusCode: 401,
      });
      return new Response(
        JSON.stringify({ error: { message: userError.message } }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // Deduct tokens for mesh operation via adam-billing
    if (!userData.user.email) {
      return new Response(
        JSON.stringify({ error: { message: 'User email missing' } }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    const meshReferenceId = crypto.randomUUID();
    try {
      const result = await billing.consume(userData.user.email, {
        tokens: MESH_TOKEN_COST,
        operation: 'mesh',
        referenceId: meshReferenceId,
      });
      if (!result.ok) {
        return new Response(
          JSON.stringify({
            error: {
              message: 'insufficient_tokens',
              code: 'insufficient_tokens',
              tokensRequired: result.tokensRequired,
              tokensAvailable: result.tokensAvailable,
            },
          }),
          {
            status: 402,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }
    } catch (err) {
      const status = err instanceof BillingClientError ? err.status : 502;
      logError(err, {
        functionName: 'mesh',
        statusCode: status,
        userId: userData.user.id,
      });
      return new Response(
        JSON.stringify({ error: { message: 'billing_unavailable' } }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    const requestBody = await req.json();

    debugLog('=== MESH FUNCTION CALLED ===');
    debugLog('Mesh function request body:', {
      ...requestBody,
      text: requestBody.text
        ? requestBody.text.substring(0, 100) + '...'
        : undefined,
    });

    const {
      images,
      mesh,
      text,
      conversationId,
      model,
      meshTopology,
      polygonCount,
      preferredFormat,
      action,
      meshId: upscaleMeshId,
      parentMessageId,
    }: {
      images?: string[];
      mesh?: string;
      text?: string;
      conversationId?: string;
      model?: Model;
      meshTopology?: 'quads' | 'polys';
      polygonCount?: number;
      preferredFormat?: 'glb' | 'fbx';
      action?: 'upscale';
      meshId?: string;
      parentMessageId?: string;
    } = requestBody;

    debugLog('Model parameter extracted:', model);

    // Handle upscale action with streaming response
    if (action === 'upscale' && upscaleMeshId && conversationId) {
      debugLog('=== UPSCALE ACTION ===');
      debugLog('Upscaling mesh:', upscaleMeshId);

      // Get the original mesh data to find the seed image
      const { data: originalMesh, error: originalMeshError } =
        await supabaseClient
          .from('meshes')
          .select('*')
          .eq('id', upscaleMeshId)
          .single();

      if (originalMeshError || !originalMesh) {
        return new Response(
          JSON.stringify({ error: { message: 'Original mesh not found' } }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      // Get the seed image from the mesh's images column
      const seedImageId = originalMesh.images?.[0];
      if (!seedImageId) {
        return new Response(
          JSON.stringify({
            error: { message: 'No seed image found for this mesh' },
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      // Download the seed image from storage
      const { data: imageBlob, error: downloadError } =
        await supabaseClient.storage
          .from('images')
          .download(`${userData.user.id}/${conversationId}/${seedImageId}`);

      if (downloadError || !imageBlob) {
        return new Response(
          JSON.stringify({
            error: { message: 'Failed to download seed image' },
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      // Upload to FAL storage
      const imageFile = new File([imageBlob], 'seed-image.png', {
        type: 'image/png',
      });
      const imageUrl = await fal.storage.upload(imageFile);
      debugLog('Uploaded seed image to FAL:', imageUrl);

      // Create new mesh entry for upscaled result
      const { data: newMeshData, error: newMeshError } = await supabaseClient
        .from('meshes')
        .insert({
          user_id: userData.user.id,
          images: originalMesh.images,
          conversation_id: conversationId,
          file_type: 'glb',
          prompt: {
            ...((originalMesh.prompt as Record<string, unknown>) || {}),
            upscaledFrom: upscaleMeshId,
            model: 'ultra', // Mark as ultra since it's upscaled
          },
        })
        .select()
        .single();

      if (newMeshError || !newMeshData) {
        return new Response(
          JSON.stringify({
            error: { message: 'Failed to create upscaled mesh entry' },
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      const newMessageId = crypto.randomUUID();
      const originalPrompt = (originalMesh.prompt as Record<string, unknown>)
        ?.text as string | undefined;

      // Create the streaming response
      const responseStream = new ReadableStream({
        async start(controller) {
          try {
            let content = {
              text: '',
              mesh: { id: newMeshData.id, fileType: 'glb' as const },
              model: 'ultra' as const,
            };

            const messageData = {
              id: newMessageId,
              conversation_id: conversationId,
              role: 'assistant',
              content,
              parent_message_id: parentMessageId || null,
              created_at: new Date().toISOString(),
            };

            // Send initial empty message to show loading state with ellipsis
            streamMessage(controller, messageData);

            // Stream the message generation using Claude
            const stream = await anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 100,
              system: upscaleSystemPrompt,
              messages: [
                {
                  role: 'user',
                  content: originalPrompt
                    ? `Generate a fun message about upscaling this: "${originalPrompt}"`
                    : 'Generate a fun message about upscaling a mesh to production quality',
                },
              ],
              stream: true,
            });

            // Stream each text delta to the client
            for await (const chunk of stream) {
              if (
                chunk.type === 'content_block_delta' &&
                chunk.delta.type === 'text_delta'
              ) {
                content = {
                  ...content,
                  text: (content.text || '') + chunk.delta.text,
                };
                streamMessage(controller, {
                  ...messageData,
                  content,
                });
              }
            }

            // Insert the final message into the database
            const { error: messageError } = await supabaseClient
              .from('messages')
              .insert({
                id: newMessageId,
                conversation_id: conversationId,
                role: 'assistant',
                content,
                parent_message_id: parentMessageId || null,
              });

            if (messageError) {
              debugLog('Failed to create upscale message:', messageError);
            }

            // Update conversation's current leaf to the new message
            await supabaseClient
              .from('conversations')
              .update({ current_message_leaf_id: newMessageId })
              .eq('id', conversationId);

            // Submit to Hunyuan3D V3 for upscaling (after message is created)
            const supabaseHost =
              (Deno.env.get('ENVIRONMENT') === 'local'
                ? Deno.env.get('NGROK_URL')
                : Deno.env.get('SUPABASE_URL')
              )?.trim() ?? '';

            const hunyuanInput = {
              input_image_url: imageUrl,
              enable_pbr: true,
              face_count: 500000,
            };
            try {
              await fal.queue.submit('fal-ai/hunyuan-3d/v3.1/pro/image-to-3d', {
                input: hunyuanInput,
                webhookUrl: `${supabaseHost}/functions/v1/fal-webhook?id=${newMeshData.id}`,
              });
              debugLog(
                'Successfully submitted to Hunyuan3D v3.1 Pro for upscaling',
              );
            } catch (submitError) {
              const errObj = submitError as {
                body?: unknown;
                status?: number;
              };
              console.error('Hunyuan v3.1 Pro submit failed:', {
                message:
                  submitError instanceof Error
                    ? submitError.message
                    : String(submitError),
                status: errObj?.status,
                body: errObj?.body,
                input: hunyuanInput,
              });
              throw submitError;
            }

            // Create a preview for the upscaled mesh (non-blocking)
            createHunyuanPreview(
              imageUrl,
              'upscale preview',
              userData.user.id,
              conversationId,
              newMeshData.id,
              supabaseHost,
            ).catch((e) =>
              debugLog('Preview creation failed (non-critical):', e),
            );

            // Stream final message state
            streamMessage(controller, {
              ...messageData,
              content,
            });

            controller.close();
          } catch (error) {
            debugLog('Error in upscale stream:', error);
            controller.error(error);
          }
        },
      });

      return new Response(responseStream, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    if (!conversationId) {
      logError(new Error('Conversation ID is required'), {
        functionName: 'mesh',
        statusCode: 400,
        userId: userData.user?.id,
      });
      return new Response(
        JSON.stringify({ error: { message: 'Conversation ID is required' } }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (
      (!images || !Array.isArray(images) || images.length === 0) &&
      !text &&
      !mesh
    ) {
      logError(new Error('Images or text not found'), {
        functionName: 'mesh',
        statusCode: 400,
        userId: userData.user?.id,
        conversationId,
        additionalContext: {
          hasImages: !!images,
          imagesLength: images?.length,
          hasText: !!text,
          hasMesh: !!mesh,
        },
      });
      return new Response(
        JSON.stringify({ error: { message: 'Images or text not found' } }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // Determine file type based on model, topology, and user preference
    let fileType: MeshFileType;
    if (
      (model === 'quality' || model === 'ultra') &&
      meshTopology === 'quads'
    ) {
      // For quad topology, allow user to choose format (default to FBX for better quad support)
      fileType = preferredFormat || 'fbx';
    } else {
      // For non-quad topology, default to GLB
      fileType = 'glb';
    }

    const { data: meshData, error: meshError } = await supabaseClient
      .from('meshes')
      .insert({
        user_id: userData.user.id,
        images: images ?? null,
        conversation_id: conversationId,
        file_type: fileType,
        prompt: {
          ...(text && { text: text }),
          ...(images && images.length > 0 && { images: images }),
          ...(mesh && { mesh: mesh }),
          ...(model && { model: model }),
        },
      })
      .select()
      .single();

    if (meshError) {
      logError(meshError, {
        functionName: 'mesh',
        statusCode: 500,
        userId: userData.user?.id,
        conversationId,
        additionalContext: {
          operation: 'insert_mesh_record',
          fileType,
          model,
        },
      });
      return new Response(
        JSON.stringify({ error: { message: meshError.message } }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // Skip Flux-based preview for quality model - use Gemini image instead (via createHunyuanPreview)
    if (model !== 'quality') {
      EdgeRuntime.waitUntil(
        submitPreviewJob(
          supabaseClient,
          text,
          images,
          mesh,
          userData.user.id,
          conversationId,
          meshData.id,
        ),
      );
    }

    console.log('=== SUBMITTING MESH JOB ===');
    debugLog(
      'Final model parameter being passed to submitMeshJob:',
      model ?? 'quality',
    );

    EdgeRuntime.waitUntil(
      submitMeshJob(
        supabaseClient,
        text,
        images,
        mesh,
        userData.user.id,
        conversationId,
        meshData.id,
        model ?? 'quality',
        meshTopology,
        polygonCount,
      ),
    );

    return new Response(JSON.stringify({ id: meshData.id, fileType }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (unexpectedError) {
    console.error('=== UNEXPECTED ERROR IN MESH FUNCTION ===');
    console.error('Unexpected error:', unexpectedError);
    console.error(
      'Error stack:',
      unexpectedError instanceof Error ? unexpectedError.stack : undefined,
    );

    return new Response(
      JSON.stringify({
        error: {
          message: 'An unexpected error occurred',
          details:
            unexpectedError instanceof Error
              ? unexpectedError.message
              : String(unexpectedError),
        },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});

// Function that submits a mesh job to fal
async function submitMeshJob(
  supabaseClient: SupabaseClient,
  text: string | undefined,
  images: string[] | undefined,
  mesh: string | undefined,
  userId: string,
  conversationId: string,
  meshId: string,
  model: Model,
  meshTopology: 'quads' | 'polys' | undefined,
  polygonCount: number | undefined,
) {
  debugLog('=== SUBMIT MESH JOB FUNCTION CALLED ===');
  debugLog('submitMeshJob received model:', model);
  // debugLog('submitMeshJob model === ultra:', model === 'ultra');

  const supabaseHost =
    (Deno.env.get('ENVIRONMENT') === 'local'
      ? Deno.env.get('NGROK_URL')
      : Deno.env.get('SUPABASE_URL')
    )?.trim() ?? '';

  debugLog('Environment variables:', {
    ENVIRONMENT: Deno.env.get('ENVIRONMENT'),
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ? 'SET' : 'NOT SET',
    NGROK_URL: Deno.env.get('NGROK_URL') ? 'SET' : 'NOT SET',
    supabaseHost: supabaseHost,
  });

  let imageInputs: string[] = [];

  try {
    // Collect all available images from different sources
    let meshImages: string[] = [];

    // If mesh is provided, get images of that mesh
    if (mesh) {
      // Get the mesh data to check if it has images
      const { data: meshData, error: meshDataError } = await supabaseClient
        .from('meshes')
        .select('images')
        .eq('id', mesh)
        .single();

      if (meshDataError) {
        // If we can't fetch mesh data, just continue without mesh images
        console.warn(`Failed to fetch mesh data: ${meshDataError.message}`);
      } else {
        // If the mesh has images in the images column, use those
        if (
          meshData.images &&
          Array.isArray(meshData.images) &&
          meshData.images.length > 0
        ) {
          // Use the image IDs directly since generateImageWithResponses expects IDs
          meshImages = meshData.images;
        } else {
          // Otherwise, use the preview images from storage
          // Check if preview images exist in storage
          const { data: previewImageList, error: previewListError } =
            await supabaseClient.storage
              .from('images')
              .list(`${userId}/${conversationId}`, {
                search: `preview-${mesh}`,
              });

          if (previewListError) {
            // If we can't list preview images, just continue without them
            console.warn(
              `Failed to list preview images: ${previewListError.message}`,
            );
          } else if (previewImageList && previewImageList.length > 0) {
            // Just use the preview image filenames - generateImageWithResponses will handle the fallback
            meshImages = previewImageList.map((file) => file.name);
          }
        }
      }
    }

    // Get the most recent mesh preview for visual continuity
    const recentMeshPreview = await getRecentMeshPreview(
      supabaseClient,
      userId,
      conversationId,
    );

    // Combine all available images (including recent mesh preview if available)
    const allImages = [...(images || []), ...meshImages];
    if (recentMeshPreview && !allImages.includes(recentMeshPreview)) {
      allImages.push(recentMeshPreview);
    }

    // Skip initial image generation for ultra model - it has its own flow
    if (model === 'ultra') {
      // Ultra model handles image generation differently, skip to model-specific logic
      debugLog('Skipping initial image generation for ultra model');
    } else if (text && text.trim() !== '') {
      // Generate images for standard and textureless models
      if (model === 'quality') {
        // Use Gemini 3 Pro with fallback to Flux for quality model
        const { data: imageData, error: imageError } = await supabaseClient
          .from('images')
          .insert({
            user_id: userId,
            conversation_id: conversationId,
            status: 'pending',
            prompt: {
              ...(text && { text: text }),
              ...(allImages.length > 0 && { images: allImages }),
              ...(model && { model: model }),
            },
          })
          .select()
          .single();

        if (imageError) {
          throw new Error(imageError.message);
        }

        await supabaseClient
          .from('meshes')
          .update({
            images: [imageData.id],
          })
          .eq('id', meshId);

        const instructions3D =
          'You are generating a fully textured and rendered 3D model. Output one centered 3D model or multiple centered objects, no text. Plain white background (or an empty background which provides optimal contrast with the textures of the 3D model), neutral lighting, and a soft shadow directly under the 3D model. Keep the entire object fully in-frame with 5–10% padding; no cropping. Make sure the description strongly impacts the form and shape of the 3D Model not just the surface texture';

        const newPrompt =
          allImages.length > 0
            ? `${instructions3D} Edit the provided image(s) to: ${text}`
            : `${instructions3D} Generate a new image: ${text}`;

        let imageBytes: Buffer;

        try {
          // Try Gemini Multi-Turn first
          debugLog('Attempting image generation with Gemini Multi-Turn');
          imageBytes = await generateImageWithGeminiMultiTurn(
            supabaseClient,
            googleGenAI,
            userId,
            conversationId,
            newPrompt,
            allImages,
          );
          debugLog('Successfully generated image with Gemini Multi-Turn');
        } catch (geminiError) {
          debugLog(
            'Gemini Multi-Turn failed, falling back to Flux:',
            geminiError,
          );
          // Fall back to Flux
          imageBytes = await generateImageWithFalFlux(
            supabaseClient,
            userId,
            conversationId,
            newPrompt,
            allImages,
          );
        }

        const { error: imageUploadError } = await supabaseClient.storage
          .from('images')
          .upload(`${userId}/${conversationId}/${imageData.id}`, imageBytes, {
            contentType: 'image/png',
          });

        if (imageUploadError) {
          throw new Error(imageUploadError.message);
        }

        await supabaseClient
          .from('images')
          .update({
            status: 'success',
          })
          .eq('id', imageData.id);

        const { data: imageSignedUrl, error: imageSignedUrlError } =
          await supabaseClient.storage
            .from('images')
            .createSignedUrl(
              `${userId}/${conversationId}/${imageData.id}`,
              60 * 60,
            );

        if (imageSignedUrlError) {
          throw new Error(imageSignedUrlError.message);
        }

        imageInputs = [reformatSignedUrl(imageSignedUrl.signedUrl)];
      } else {
        // Standard single-image generation for fast mode
        const { data: imageData, error: imageError } = await supabaseClient
          .from('images')
          .insert({
            user_id: userId,
            conversation_id: conversationId,
            status: 'pending',
            prompt: {
              ...(text && { text: text }),
              ...(allImages.length > 0 && { images: allImages }),
              ...(model && { model: model }),
            },
          })
          .select()
          .single();

        if (imageError) {
          throw new Error(imageError.message);
        }

        await supabaseClient
          .from('meshes')
          .update({
            images: [imageData.id],
          })
          .eq('id', meshId);

        const instructions3D =
          'You are generating a fully textured and rendered 3D model. Output one centered 3D model or multiple centered objects, no text. Plain white background (or an empty background which provides optimal contrast with the textures of the 3D model), neutral lighting, and a soft shadow directly under the 3D model. Keep the entire object fully in-frame with 5–10% padding; no cropping. Make sure the description strongly impacts the form and shape of the 3D Model not just the surface texture';

        const newPrompt =
          allImages.length > 0
            ? `${instructions3D} Edit the provided image(s) to: ${text}`
            : `${instructions3D} Generate a new image: ${text}`;

        const imageBytes = await generateImageWithFalFlux(
          supabaseClient,
          userId,
          conversationId,
          newPrompt,
          allImages,
        );

        const { error: imageUploadError } = await supabaseClient.storage
          .from('images')
          .upload(`${userId}/${conversationId}/${imageData.id}`, imageBytes, {
            contentType: 'image/png',
          });

        if (imageUploadError) {
          throw new Error(imageUploadError.message);
        }

        await supabaseClient
          .from('images')
          .update({ status: 'success' })
          .eq('id', imageData.id);

        const { data: imageSignedUrl, error: imageSignedUrlError } =
          await supabaseClient.storage
            .from('images')
            .createSignedUrl(
              `${userId}/${conversationId}/${imageData.id}`,
              60 * 60,
            );

        if (imageSignedUrlError) {
          throw new Error(imageSignedUrlError.message);
        }

        imageInputs = [reformatSignedUrl(imageSignedUrl.signedUrl)];
      }
    } else {
      // No text provided, use the collected images directly for mesh generation
      if (allImages.length === 0) {
        throw new Error('No images or text provided for mesh generation');
      }

      const imageFiles = allImages.map(
        (image: string) => `${userId}/${conversationId}/${image}`,
      );
      const { data: imageSignedUrls, error: imageSignedUrlsError } =
        await supabaseClient.storage
          .from('images')
          .createSignedUrls(imageFiles, 60 * 60);

      if (imageSignedUrlsError) {
        throw new Error(imageSignedUrlsError.message);
      }

      // Filter out any errors and map to just get signedURL, swap out basename for supabase host
      imageInputs = imageSignedUrls
        .filter((image) => !image.error && image.signedUrl)
        .map((image) => reformatSignedUrl(image.signedUrl));

      if (imageInputs.length === 0) {
        throw new Error('No valid images found for mesh generation');
      }
    }

    // Only validate imageInputs for non-ultra models
    // Ultra generates its own images in its specific block
    if (imageInputs.length === 0 && model !== 'ultra') {
      throw new Error('No valid images for 3D generation');
    }

    debugLog('=== CHECKING MODEL TYPE ===');
    debugLog('model value:', model);

    if (model === 'ultra') {
      debugLog('=== ENTERING ULTRA MODEL PATH (MESHY V6 PREVIEW) ===');

      // Check if this is first generation or conversational edit by looking for COMPLETED meshes (not images)
      // This properly handles branching - a branch won't have completed meshes
      const { data: existingCompletedMeshes, error: meshesError } =
        await supabaseClient
          .from('meshes')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('user_id', userId)
          .eq('status', 'success');

      if (meshesError) {
        throw new Error(meshesError.message);
      }

      const isFirstGeneration =
        !existingCompletedMeshes || existingCompletedMeshes.length === 0;
      const hasUploadedImages = allImages.length > 0;
      const hasText = text && text.trim() !== '';

      // Determine generation method
      // First generation: Use Gemini Flash for text-only, Gemini Flash edit for image uploads
      // Conversational edits: Use Gemini Multi-Turn to maintain full context
      const useGeminiFlash = isFirstGeneration && !hasUploadedImages && hasText;
      const useGeminiFlashEdit = isFirstGeneration && hasUploadedImages;

      debugLog(
        `Ultra generation type: First=${isFirstGeneration}, HasImages=${hasUploadedImages}, HasText=${hasText}`,
      );
      debugLog(
        `Using: ${useGeminiFlash ? 'Gemini Flash (first text-only)' : useGeminiFlashEdit ? 'Gemini Flash edit (first with images)' : 'Gemini Multi-Turn (conversational)'}`,
      );

      // Validate we have something to work with
      if (!hasText && !hasUploadedImages && isFirstGeneration) {
        throw new Error('No text or images provided for ultra generation');
      }

      // Create image record
      const { data: imageData, error: imageError } = await supabaseClient
        .from('images')
        .insert({
          user_id: userId,
          conversation_id: conversationId,
          status: 'pending',
          prompt: {
            ...(text && { text: text }),
            ...(allImages.length > 0 && { images: allImages }),
            ...(model && { model: model }),
          },
        })
        .select()
        .single();

      if (imageError) {
        throw new Error(imageError.message);
      }

      await supabaseClient
        .from('meshes')
        .update({
          images: [imageData.id],
        })
        .eq('id', meshId);

      // Use consistent instructions for base image generation
      const instructions3D =
        'You are generating a fully textured and rendered 3D model. Output one centered 3D model or multiple centered objects, no text. Plain white background (or an empty background which provides optimal contrast with the textures of the 3D model), neutral lighting, and a soft shadow directly under the 3D model. Keep the entire object fully in-frame with 5–10% padding; no cropping. Make sure the description strongly impacts the form and shape of the 3D Model not just the surface texture';

      let imageBytes: Buffer;

      if (useGeminiFlash) {
        const flashPrompt = `${instructions3D} Generate: ${text}`;
        imageBytes = await generateImageWithGeminiFlash(
          googleGenAI,
          flashPrompt,
        );
      } else if (useGeminiFlashEdit) {
        const uploadedImage = allImages[0];
        const baseImageUrl = await getSignedImageUrl(
          supabaseClient,
          userId,
          conversationId,
          uploadedImage,
        );
        const flashEditPrompt = hasText
          ? `${instructions3D} Edit this image to: ${text}`
          : `${instructions3D} Enhance and optimize this image for 3D model generation`;
        imageBytes = await generateImageWithGeminiFlashEdit(
          googleGenAI,
          flashEditPrompt,
          baseImageUrl,
        );
      } else {
        const conversationalPrompt = hasUploadedImages
          ? hasText
            ? `${instructions3D} Edit the provided image(s) to: ${text}`
            : `${instructions3D} Enhance and optimize the provided image(s) for 3D model generation`
          : hasText
            ? `${instructions3D} Edit/modify the previous generation: ${text}`
            : `${instructions3D} Enhance and optimize the previous generation`;

        try {
          imageBytes = await generateImageWithGeminiMultiTurn(
            supabaseClient,
            googleGenAI,
            userId,
            conversationId,
            conversationalPrompt,
            allImages,
          );
        } catch (_fallbackError) {
          imageBytes = await generateImageWithFalFlux(
            supabaseClient,
            userId,
            conversationId,
            conversationalPrompt,
            allImages,
          );
        }
      }

      // Upload the generated base image
      const { error: imageUploadError } = await supabaseClient.storage
        .from('images')
        .upload(`${userId}/${conversationId}/${imageData.id}`, imageBytes, {
          contentType: 'image/png',
        });

      if (imageUploadError) {
        throw new Error(imageUploadError.message);
      }

      await supabaseClient
        .from('images')
        .update({ status: 'success' })
        .eq('id', imageData.id);

      // Get signed URL for the base image to send to Meshy
      const { data: imageSignedUrl, error: imageSignedUrlError } =
        await supabaseClient.storage
          .from('images')
          .createSignedUrl(
            `${userId}/${conversationId}/${imageData.id}`,
            60 * 60,
          );

      if (imageSignedUrlError) {
        throw new Error(imageSignedUrlError.message);
      }

      const baseImageUrl = reformatSignedUrl(imageSignedUrl.signedUrl);

      // Configure Meshy parameters
      // Topology: default to triangle (Meshy standard), but respect quad if requested
      const meshyTopology = meshTopology === 'quads' ? 'quad' : 'triangle';

      // Polycount: default 30000, clamp between 200 and 300000 (Meshy v6 API limit)
      const safePolycount = polygonCount
        ? Math.max(200, Math.min(300000, polygonCount))
        : 30000;

      debugLog('Submitting to Meshy v6 Preview', {
        topology: meshyTopology,
        polycount: safePolycount,
      });

      const meshyInput = {
        image_url: baseImageUrl,
        topology: meshyTopology as 'quad' | 'triangle',
        target_polycount: safePolycount,
        symmetry_mode: 'auto' as const,
        should_remesh: true,
        should_texture: true,
        enable_pbr: true, // Max quality feature
      };

      await fal.queue.submit('fal-ai/meshy/v6-preview/image-to-3d', {
        input: meshyInput,
        webhookUrl: `${supabaseHost}/functions/v1/fal-webhook?id=${meshId}`,
      });

      debugLog('Successfully submitted to Meshy v6 Preview');

      // Create preview using the base image
      await createHunyuanPreview(
        baseImageUrl,
        'ultra meshy v6 preview',
        userId,
        conversationId,
        meshId,
        supabaseHost,
      );
    } else if (model === 'quality') {
      debugLog('=== ENTERING QUALITY MODEL PATH (SAM 3D) ===');

      if (imageInputs.length === 0) {
        throw new Error('No valid image found for quality mesh generation');
      }

      const imageUrl = imageInputs[0];

      // ========================================================================
      // SAM 3D PIPELINE WITH MOONDREAM3 CAPTIONING
      // Strategy:
      // 1. Pre-fetch Moondream3 long caption and genericize it
      // 2. Try simple prompt "all the 3d models in the scene" first
      // 3. If low score, fallback to genericized caption
      // 4. If still no mask, use full-image box prompt as last resort
      // ========================================================================

      // ---- Step 1: Caption image with Moondream3 (long only to save CPU) ----
      let longCaption: string | null = null;

      try {
        debugLog('Step 1: Captioning image with Moondream3 (long only)...');

        const longResult = await fal.subscribe(
          'fal-ai/moondream3-preview/caption',
          {
            input: { length: 'long', image_url: imageUrl },
          },
        );

        const longData = longResult.data;
        if (longData && typeof longData === 'object' && 'output' in longData) {
          longCaption =
            typeof longData.output === 'string' ? longData.output : null;
        }

        debugLog('Moondream3 caption:', longCaption?.substring(0, 100) + '...');

        // Genericize the caption - replace character names with visual descriptions
        if (longCaption) {
          const genericizePrompt = `Replace ALL character names, brand names, IP names, and proper nouns with generic visual descriptions. Keep sentence structure intact.

Rules:
- Replace ANY character name (Pikachu, Sonic, Mario, Dexter, SpongeBob, etc.) with visual descriptions
- "Pikachu" -> "yellow creature with pointed ears"
- "Sonic" -> "blue spiky creature"  
- "Dexter" -> "boy with glasses" or "humanoid figure"
- "SpongeBob" -> "yellow sponge creature"
- Remove references like "from Dexter's Laboratory" or "from Pokemon"
- Keep color, pose, action, and position descriptions
- Keep ALL non-name words exactly the same

Input: ${longCaption}

Output:`;

          try {
            const genericResult = await googleGenAI.models.generateContent({
              model: 'gemini-2.5-flash-lite',
              contents: [{ role: 'user', parts: [{ text: genericizePrompt }] }],
            });
            const genericText =
              genericResult.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (genericText) {
              longCaption = genericText;
              debugLog(
                'Genericized caption:',
                longCaption.substring(0, 100) + '...',
              );
            }
          } catch (genError) {
            debugLog('Failed to genericize, using original:', genError);
          }
        }
      } catch (error) {
        debugLog('Error getting Moondream3 caption:', error);
      }

      // ---- Step 2: Try prompts with SAM-3/image ----
      let maskUrl: string | null = null;
      const MIN_MASK_SCORE = 0.25;

      // Helper to try a prompt with SAM-3/image
      const tryPrompt = async (name: string, prompt: string) => {
        try {
          debugLog(`Trying prompt "${name}":`, prompt);
          const result = await fal.subscribe('fal-ai/sam-3/image', {
            input: {
              image_url: imageUrl,
              prompt: prompt,
              apply_mask: false,
              include_scores: true,
            },
          });

          const data = result.data;
          if (!data || typeof data !== 'object') {
            return { name, score: 0, url: null };
          }

          const masks =
            'masks' in data && Array.isArray(data.masks) ? data.masks : [];
          const scores =
            'scores' in data && Array.isArray(data.scores) ? data.scores : [];

          const score = typeof scores[0] === 'number' ? scores[0] : 0;
          const firstMask = masks[0];
          const url =
            firstMask &&
            typeof firstMask === 'object' &&
            'url' in firstMask &&
            typeof firstMask.url === 'string'
              ? firstMask.url
              : null;

          debugLog(`Prompt "${name}" result:`, { score, hasMask: !!url });
          return { name, score, url };
        } catch (error) {
          debugLog(`Prompt "${name}" failed:`, error);
          return { name, score: 0, url: null };
        }
      };

      // Try "simple" first, fallback to long_caption
      debugLog('Step 2: Trying "simple" prompt first...');
      let result = await tryPrompt('simple', 'all the 3d models in the image');

      if (result.url && result.score >= MIN_MASK_SCORE) {
        maskUrl = result.url;
        debugLog('SUCCESS: Using "simple" mask, score:', result.score);
      } else if (longCaption) {
        debugLog(
          '"simple" failed or low score, trying long_caption fallback...',
        );
        result = await tryPrompt('long_caption', longCaption);

        if (result.url && result.score >= MIN_MASK_SCORE) {
          maskUrl = result.url;
          debugLog(
            'SUCCESS: Using "long_caption" fallback mask, score:',
            result.score,
          );
        }
      } else {
        debugLog(
          'WARNING: Simple prompt failed and no Moondream caption available for fallback',
        );
      }

      if (maskUrl) {
        debugLog('Selected mask URL:', maskUrl.substring(0, 50) + '...');
      } else {
        debugLog('No valid mask from prompts, will use box fallback');
      }

      // Build SAM-3D input
      interface Sam3dInput {
        image_url: string;
        mask_urls?: string[];
        box_prompts?: {
          x_min: number;
          y_min: number;
          x_max: number;
          y_max: number;
          object_id: number;
        }[];
      }
      const sam3dInput: Sam3dInput = { image_url: imageUrl };

      if (maskUrl) {
        sam3dInput.mask_urls = [maskUrl];
        debugLog('Using SAM-3/image mask for SAM 3D');
      } else {
        // Fallback: full-image box prompt (5% inset, assumes 1024x1024)
        // This guarantees segmentation when text prompts fail
        sam3dInput.box_prompts = [
          { x_min: 51, y_min: 51, x_max: 973, y_max: 973, object_id: 1 },
        ];
        debugLog('No mask found, using full-image box fallback');
      }

      debugLog('SAM 3D input:', JSON.stringify(sam3dInput, null, 2));

      await fal.queue.submit('fal-ai/sam-3/3d-objects', {
        input: sam3dInput,
        webhookUrl: `${supabaseHost}/functions/v1/fal-webhook?id=${meshId}`,
      });

      debugLog('Successfully submitted to SAM 3D');

      // Create preview
      await createHunyuanPreview(
        imageUrl,
        'quality SAM 3D seed image',
        userId,
        conversationId,
        meshId,
        supabaseHost,
      );
    } else {
      debugLog('=== ENTERING FAST MODEL PATH (TRIPO TEXTURELESS) ===');

      // Use the image generated in the earlier block
      if (imageInputs.length === 0) {
        throw new Error('No valid image found for textureless mesh generation');
      }

      // Submit to Tripo v2.5 with the generated image
      // NOTE: H3.1 (newer model) currently returns downstream_service_error on
      // textureless requests (Tripo-side 500). Reverted to v2.5 until fixed.
      const tripoInput = {
        image_url: imageInputs[0],
        texture: 'no' as const,
        orientation: 'default' as const,
        // Cap face count for textureless generations at 50k
        ...(polygonCount !== undefined
          ? { face_limit: Math.min(polygonCount, TEXTURELESS_MAX_POLYGONS) }
          : { face_limit: TEXTURELESS_MAX_POLYGONS }),
      };
      try {
        await fal.queue.submit('tripo3d/tripo/v2.5/image-to-3d', {
          input: tripoInput,
          webhookUrl: `${supabaseHost}/functions/v1/fal-webhook?id=${meshId}`,
        });
        debugLog(
          'Successfully submitted to Tripo v2.5 textureless with conversational context',
        );
      } catch (submitError) {
        const errObj = submitError as { body?: unknown; status?: number };
        console.error('Tripo v2.5 submit failed:', {
          message:
            submitError instanceof Error
              ? submitError.message
              : String(submitError),
          status: errObj?.status,
          body: errObj?.body,
          input: tripoInput,
        });
        throw submitError;
      }

      // Create preview using the generated image
      await createHunyuanPreview(
        imageInputs[0],
        'textureless preview',
        userId,
        conversationId,
        meshId,
        supabaseHost,
      );
    }
  } catch (error) {
    console.error('Mesh generation failed:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      meshId,
      model,
      hasText: !!text,
      hasImages: !!(images && images.length > 0),
      imageInputsLength: imageInputs.length,
      supabaseHost,
    });

    logApiError(error, {
      functionName: 'mesh',
      apiName: 'FAL AI',
      statusCode: 500,
      userId,
      conversationId,
      requestData: { meshId, model, meshTopology, polygonCount },
    });

    await supabaseClient
      .from('meshes')
      .update({ status: 'failure' })
      .eq('id', meshId);

    const channel = supabaseClient.channel(`mesh-updates-${userId}`);
    await channel.send({
      type: 'broadcast',
      event: 'mesh-updated',
      payload: {
        kind: 'mesh',
        id: meshId,
        status: 'failure',
        conversation_id: conversationId,
      },
    });
  }
}

// Function that submits a mesh job to fal
async function submitPreviewJob(
  supabaseClient: SupabaseClient,
  text: string | undefined,
  images: string[] | undefined,
  mesh: string | undefined,
  userId: string,
  conversationId: string,
  meshId: string,
) {
  const supabaseHost =
    (Deno.env.get('ENVIRONMENT') === 'local'
      ? Deno.env.get('NGROK_URL')
      : Deno.env.get('SUPABASE_URL')
    )?.trim() ?? '';

  let imageInputs: string[] = [];

  let previewId: string | null = null;

  try {
    const { data: previewData, error: previewError } = await supabaseClient
      .from('previews')
      .insert({
        user_id: userId,
        conversation_id: conversationId,
        mesh_id: meshId,
      })
      .select()
      .single();

    if (previewError) {
      throw new Error(previewError.message);
    }

    previewId = previewData.id;

    // Collect all available images from different sources
    let meshImages: string[] = [];

    // If mesh is provided, get images of that mesh
    if (mesh) {
      // Get the mesh data to check if it has images
      const { data: meshData, error: meshDataError } = await supabaseClient
        .from('meshes')
        .select('images')
        .eq('id', mesh)
        .single();

      if (meshDataError) {
        // If we can't fetch mesh data, just continue without mesh images
        console.warn(`Failed to fetch mesh data: ${meshDataError.message}`);
      } else {
        // If the mesh has images in the images column, use those
        if (
          meshData.images &&
          Array.isArray(meshData.images) &&
          meshData.images.length > 0
        ) {
          // Use the image IDs directly since generateImageWithResponses expects IDs
          meshImages = meshData.images;
        } else {
          // Otherwise, use the preview images from storage
          // Check if preview images exist in storage
          const { data: previewImageList, error: previewListError } =
            await supabaseClient.storage
              .from('images')
              .list(`${userId}/${conversationId}`, {
                search: `preview-${mesh}`,
              });

          if (previewListError) {
            // If we can't list preview images, just continue without them
            console.warn(
              `Failed to list preview images: ${previewListError.message}`,
            );
          } else if (previewImageList && previewImageList.length > 0) {
            // Just use the preview image filenames - generateImageWithResponses will handle the fallback
            meshImages = previewImageList.map((file) => file.name);
          }
        }
      }
    }

    // Combine all available images
    const allImages = [...(images || []), ...meshImages];

    const imageGuidance =
      'You are generating a fully textured and rendered 3D model. Output one centered 3D model or multiple centered objects, no text.  Plain white background (or an empty background which provides optimal contrast with the textures of the 3D model) , neutral lighting, and a soft shadow directly under the 3D model. Keep the entire object fully in-frame with 5–10% padding; no cropping. Make sure the description strongly impacts the form and shape of the 3D Model not just the surface texture';

    // If text exists, we generate an image from 4o then use that image to generate a mesh
    if (text && text.trim() !== '') {
      const newPrompt =
        allImages.length > 0
          ? `Edit the provided image(s) to: ${text} Style: ${imageGuidance}`
          : `Generate a new image: ${text} Style: ${imageGuidance}`;

      const imageBytes = await generateImageWithFalFlux(
        supabaseClient,
        userId,
        conversationId,
        newPrompt,
        allImages,
      );

      const imageId = crypto.randomUUID();

      const { error: imageUploadError } = await supabaseClient.storage
        .from('images')
        .upload(`${userId}/${conversationId}/${imageId}`, imageBytes, {
          contentType: 'image/png',
        });

      if (imageUploadError) {
        throw new Error(imageUploadError.message);
      }

      const { data: imageSignedUrl, error: imageSignedUrlError } =
        await supabaseClient.storage
          .from('images')
          .createSignedUrl(`${userId}/${conversationId}/${imageId}`, 60 * 60);

      if (imageSignedUrlError) {
        throw new Error(imageSignedUrlError.message);
      }

      imageInputs = [reformatSignedUrl(imageSignedUrl.signedUrl)];
    } else {
      // No text provided, use the collected images directly for mesh generation
      if (allImages.length === 0) {
        throw new Error('No images or text provided for mesh generation');
      }

      const imageFiles = allImages.map(
        (image: string) => `${userId}/${conversationId}/${image}`,
      );
      const { data: imageSignedUrls, error: imageSignedUrlsError } =
        await supabaseClient.storage
          .from('images')
          .createSignedUrls(imageFiles, 60 * 60);

      if (imageSignedUrlsError) {
        throw new Error(imageSignedUrlsError.message);
      }

      // Filter out any errors and map to just get signedURL, swap out basename for supabase host
      imageInputs = imageSignedUrls
        .filter((image) => !image.error && image.signedUrl)
        .map((image) => reformatSignedUrl(image.signedUrl));

      if (imageInputs.length === 0) {
        throw new Error('No valid images found for mesh generation');
      }
    }

    if (imageInputs.length === 0) {
      throw new Error('No valid images for 3D generation');
    }

    await fal.queue.submit('fal-ai/hunyuan3d/v2/mini/turbo', {
      input: {
        input_image_url: imageInputs[0],
      },
      webhookUrl: `${supabaseHost}/functions/v1/fal-webhook?id=${previewId}&mode=preview`,
    });
  } catch (error) {
    logApiError(error, {
      functionName: 'mesh',
      apiName: 'FAL AI Preview',
      statusCode: 500,
      userId,
      conversationId,
      requestData: { previewId, meshId },
    });
    console.error(error);
    if (previewId) {
      supabaseClient
        .from('previews')
        .update({ status: 'failure' })
        .eq('id', previewId);
    }
  }
  // Don't need to send update to channel because it's not a mesh we care about
}

// Helper function to create GLB preview using Hunyuan3D Mini Turbo
async function createHunyuanPreview(
  imageUrl: string,
  description: string,
  userId: string,
  conversationId: string,
  meshId: string,
  supabaseHost: string,
): Promise<void> {
  try {
    const { data: previewData, error: previewError } = await supabaseClient
      .from('previews')
      .insert({
        user_id: userId,
        conversation_id: conversationId,
        mesh_id: meshId,
      })
      .select()
      .single();

    if (previewError) {
      debugLog(`Failed to create preview record: ${previewError.message}`);
      return;
    }

    if (previewData) {
      // Hunyuan3D Mini Turbo for fast preview generation
      await fal.queue.submit('fal-ai/hunyuan3d/v2/mini/turbo', {
        input: {
          input_image_url: imageUrl,
        },
        webhookUrl: `${supabaseHost}/functions/v1/fal-webhook?id=${previewData.id}&mode=preview`,
      });
      debugLog(`Successfully submitted ${description} to Hunyuan3D Mini Turbo`);
    }
  } catch (error) {
    debugLog(
      `Error creating Hunyuan preview: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
