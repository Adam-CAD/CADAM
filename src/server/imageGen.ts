import { Buffer } from 'node:buffer';
import type { SupabaseClient } from './supabaseClient';
import { GoogleGenAI, Modality } from '@google/genai';
import { fal } from '@fal-ai/client';
import OpenAI from 'openai';
import { reformatSignedUrl } from './messageUtils';
import { env, requiredEnv } from './env';

const DEBUG_LOGS =
  env('ENVIRONMENT') === 'local' || env('DEBUG_LOGS') === 'true';
const debugLog = (...args: unknown[]) => {
  if (DEBUG_LOGS) console.log(...args);
};

// Shared 3D model generation instructions for consistency across all image generation services
export const INSTRUCTIONS_3D =
  'You are generating a fully textured and rendered 3D model. Output one centered 3D model or multiple centered objects, no text. Plain white background (or an empty background which provides optimal contrast with the textures of the 3D model), neutral lighting, and a soft shadow directly under the 3D model. Keep the entire object fully in-frame with 5–10% padding; no cropping. Make sure the description strongly impacts the form and shape of the 3D Model not just the surface texture';

let falConfigured = false;
function ensureFalConfig() {
  if (falConfigured) return;
  fal.config({ credentials: requiredEnv('FAL_KEY') });
  falConfigured = true;
}

/* DEPRECATED: Gemini 2.0 Flash discontinued March 2026
   Keeping for potential rollback. Remove after migration confirmed stable.
export const generateImageWithGemini = async (
  supabaseClient: SupabaseClient,
  googleGenAI: GoogleGenAI,
  userId: string,
  conversationId: string,
  prompt: string,
  images: string[],
) => {
  let generatedImageData;
  if (images.length > 0) {
    const { data: imageData } = await supabaseClient.storage
      .from('images')
      .download(`${userId}/${conversationId}/${images[0]}`);

    if (!imageData) {
      throw new Error('Failed to download image');
    }
    // Convert imageData to base64 for use with Gemini
    const imageBytes = await imageData.arrayBuffer();
    const base64Image = Buffer.from(imageBytes).toString('base64');

    const contents = [
      { text: prompt ? prompt : 'Generate an image similar to this' },
      {
        inlineData: {
          mimeType: 'image/png',
          data: base64Image,
        },
      },
    ];

    const result = await googleGenAI.models.generateContent({
      contents: contents,
      model: 'gemini-2.0-flash-preview-image-generation',
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });

    if (
      !result.candidates ||
      !result.candidates[0] ||
      !result.candidates[0].content ||
      !result.candidates[0].content.parts
    ) {
      throw new Error('No result from Gemini');
    }

    for (const part of result.candidates[0].content.parts) {
      // Based on the part type, either show the text or save the image
      if (part.inlineData) {
        generatedImageData = part.inlineData.data;
      }
    }
  } else {
    const result = await googleGenAI.models.generateImages({
      prompt: prompt,
      model: 'imagen-3.0-generate-002',
      config: {
        numberOfImages: 1,
        aspectRatio: '1:1',
        personGeneration: PersonGeneration.ALLOW_ADULT,
      },
    });

    if (!result.generatedImages || result.generatedImages.length === 0) {
      throw new Error('No generated images from Gemini');
    }

    for (const generatedImage of result.generatedImages) {
      generatedImageData = generatedImage.image?.imageBytes;
    }
  }

  if (!generatedImageData) {
    throw new Error('No generated image data from Gemini');
  }

  const imageBytes = Buffer.from(generatedImageData, 'base64');
  return imageBytes;
};
*/

export type GptImageQuality = 'low' | 'medium' | 'high';

export type GptImage2Result = {
  imageBytes: Buffer;
  imageCallId: string | null;
  // MIME of the returned bytes — gpt-image-2 returns jpeg per our tool
  // config. Callers must use this when persisting to storage so the
  // Content-Type header matches the actual bytes.
  contentType: 'image/jpeg';
};

/**
 * Generates an image with gpt-image-2 via the OpenAI Responses API.
 * This is the default image model for mesh mode.
 *
 * Multi-turn: when `priorImageCallId` is provided, the prior
 * image_generation_call is referenced by ID (the canonical edit pattern)
 * instead of re-encoding the image as base64. Newly uploaded references
 * (no prior call ID) fall through to input_image base64.
 *
 * Output format: jpeg. Per OpenAI's docs, jpeg is faster than png with
 * the image_generation tool, and our downstream 3D pipelines don't need
 * alpha (we also set background=opaque). Latency win.
 */
export const generateImageWithGptImage2 = async (
  supabaseClient: SupabaseClient,
  openAI: OpenAI,
  userId: string,
  conversationId: string,
  prompt: string,
  images: string[],
  priorImageCallId: string | null,
  // 'low' (~$0.006) for fast/draft use, 'high' (~$0.21) for final mesh
  // seeds. 'medium' also available (~$0.053).
  quality: GptImageQuality,
): Promise<GptImage2Result> => {
  debugLog('Generating image with gpt-image-2 via Responses API', {
    userId,
    conversationId,
    prompt,
    imagesCount: images.length,
    priorImageCallId,
  });

  const content: Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string; detail: 'auto' }
  > = [{ type: 'input_text', text: prompt || 'Generate an image' }];

  // Base64 path is only used when we have no prior gpt-image-2 call to
  // reference (e.g. a freshly uploaded user image).
  const shouldEncodeReference = !priorImageCallId && images.length > 0;

  if (shouldEncodeReference) {
    const latestImageId = images[images.length - 1];
    const { data: imageData } = await supabaseClient.storage
      .from('images')
      .download(`${userId}/${conversationId}/${latestImageId}`);

    if (!imageData) {
      throw new Error(`Failed to download image ${latestImageId}`);
    }

    const imageArrayBuffer = await imageData.arrayBuffer();
    const base64Image = Buffer.from(imageArrayBuffer).toString('base64');
    const mimeType =
      imageData.type && imageData.type.startsWith('image/')
        ? imageData.type
        : 'image/png';

    content.push({
      type: 'input_image',
      image_url: `data:${mimeType};base64,${base64Image}`,
      detail: 'auto',
    });
  }

  const input: Array<
    | { role: 'user'; content: typeof content }
    | {
        type: 'image_generation_call';
        id: string;
        result: string | null;
        status: 'completed';
      }
  > = [];

  // Prior assistant-side image_generation_call must precede the new user
  // message so the model sees the image it produced before the edit request.
  if (priorImageCallId) {
    input.push({
      type: 'image_generation_call',
      id: priorImageCallId,
      result: null,
      status: 'completed',
    });
  }

  input.push({ role: 'user', content });

  // gpt-5.4 is the canonical orchestrator for the Responses API
  // image_generation tool per OpenAI's docs; gpt-image-2 is the actual
  // image model invoked via the tool.
  const response = await openAI.responses.create({
    model: 'gpt-5.4',
    input,
    tools: [
      {
        type: 'image_generation',
        model: 'gpt-image-2',
        quality,
        size: '1024x1024',
        output_format: 'jpeg',
        background: 'opaque',
        moderation: 'low',
      },
    ],
  });

  const imageCalls = response.output.flatMap((item) =>
    item.type === 'image_generation_call' ? [item] : [],
  );
  const latestCall = imageCalls[imageCalls.length - 1];

  if (!latestCall?.result) {
    throw new Error('No generated image data from gpt-image-2');
  }

  debugLog('Successfully generated image with gpt-image-2', {
    imageCallId: latestCall.id,
    status: latestCall.status,
  });

  return {
    imageBytes: Buffer.from(latestCall.result, 'base64'),
    imageCallId: latestCall.id,
    contentType: 'image/jpeg',
  };
};

export const generateImageWithGeminiMultiTurn = async (
  supabaseClient: SupabaseClient,
  googleGenAI: GoogleGenAI,
  userId: string,
  conversationId: string,
  prompt: string,
  images: string[],
): Promise<Buffer> => {
  debugLog('Generating image with Gemini Multi-Turn', {
    userId,
    conversationId,
    prompt,
    imagesCount: images.length,
  });

  let imagePart: { inlineData: { mimeType: string; data: string } } | undefined;

  // If there are images, use the latest one as context for the multi-turn edit
  if (images.length > 0) {
    const latestImageId = images[images.length - 1]; // Use the last image for continuity
    const { data: imageData } = await supabaseClient.storage
      .from('images')
      .download(`${userId}/${conversationId}/${latestImageId}`);

    if (!imageData) {
      throw new Error(`Failed to download image ${latestImageId}`);
    }

    const imageArrayBuffer = await imageData.arrayBuffer();
    const buffer = Buffer.from(imageArrayBuffer);
    const base64Image = buffer.toString('base64');
    // Derive mimeType from the blob rather than hardcoding png —
    // gpt-image-2 stores jpeg, so a Gemini fallback on a later turn
    // would otherwise send jpeg bytes declared as png and get rejected
    // (or produce corrupt output).
    const mimeType =
      imageData.type && imageData.type.startsWith('image/')
        ? imageData.type
        : 'image/png';

    imagePart = {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    };
  }

  // Initialize chat with the new Gemini 3 Pro Image Preview model
  const chat = googleGenAI.chats.create({
    model: 'gemini-3-pro-image-preview',
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      // Note: Google Search grounding is built into gemini-3-pro-image-preview
      // and doesn't need to be explicitly enabled as a tool for image generation
    },
  });

  const messageContent: {
    text?: string;
    inlineData?: { mimeType: string; data: string };
  }[] = [{ text: prompt || 'Generate an image' }];
  if (imagePart) {
    messageContent.push(imagePart);
  }

  debugLog('Sending message to Gemini Multi-Turn Chat');
  const response = await chat.sendMessage({
    message: messageContent,
  });

  if (
    !response.candidates ||
    !response.candidates[0] ||
    !response.candidates[0].content ||
    !response.candidates[0].content.parts
  ) {
    throw new Error('No result from Gemini Multi-Turn');
  }

  let generatedImageData: string | undefined;

  for (const part of response.candidates[0].content.parts) {
    if (part.text) {
      debugLog('Gemini Text Response:', part.text);
    } else if (part.inlineData) {
      generatedImageData = part.inlineData.data;
    }
  }

  if (!generatedImageData) {
    throw new Error('No generated image data from Gemini Multi-Turn');
  }

  const imageBytes = Buffer.from(generatedImageData, 'base64');
  return imageBytes;
};

export const generateImageWithFalFlux = async (
  supabaseClient: SupabaseClient,
  userId: string,
  conversationId: string,
  promptText: string,
  images: string[],
) => {
  ensureFalConfig();
  // Extract all available images for visual context, similar to how OpenAI processes them
  const contextImages: string[] = [];

  if (images.length > 0) {
    // Process images the same way OpenAI would, but collect them for Flux
    await Promise.all(
      images.map(async (image) => {
        // First check if this image exists in storage
        const { data: exists } = await supabaseClient.storage
          .from('images')
          .exists(`${userId}/${conversationId}/${image}`);

        if (exists) {
          contextImages.push(image);
        }
      }),
    );
  }

  // Enhance the prompt with 3D instructions and context
  const enhancedPrompt =
    contextImages.length > 0
      ? `${INSTRUCTIONS_3D} Based on the provided image(s), ${promptText}. Maintain visual consistency and style with the reference image(s).`
      : `${INSTRUCTIONS_3D} ${promptText}`;

  let imageInputs: string[] = [];
  if (contextImages.length > 0) {
    const imageFiles = contextImages.map((image) => {
      return `${userId}/${conversationId}/${image}`;
    });

    const { data: rawImageUrls } = await supabaseClient.storage
      .from('images')
      .createSignedUrls(imageFiles, 60 * 60);

    if (!rawImageUrls) {
      throw new Error('No image URL from Flux');
    }

    imageInputs = rawImageUrls
      .filter((image) => !image.error && image.signedUrl)
      .map((image) => reformatSignedUrl(image.signedUrl!));
  }

  if (imageInputs.length > 0) {
    const result = await fal.run('fal-ai/flux-pro/kontext/max/multi', {
      input: {
        prompt: enhancedPrompt,
        image_urls: imageInputs,
        safety_tolerance: '6',
      },
    });

    const imageUrl = result.data.images[0];
    const response = await fetch(imageUrl.url);
    const imageBytes = await response.arrayBuffer();
    return Buffer.from(imageBytes);
  } else {
    const result = await fal.run('fal-ai/flux-pro/v1.1', {
      input: {
        prompt: enhancedPrompt,
        safety_tolerance: '6',
      },
    });

    const imageUrl = result.data.images[0];
    const response = await fetch(imageUrl.url);
    const imageBytes = await response.arrayBuffer();
    return Buffer.from(imageBytes);
  }
};

/* DEPRECATED: Replaced by generateImageWithFalFlux
   Keeping for potential rollback. Remove after migration confirmed stable.
export const generateImageWithFlux = async (
  supabaseClient: SupabaseClient,
  replicateClient: Replicate,
  userId: string,
  conversationId: string,
  prompt: string,
  images: string[],
) => {
  let imageUrl;
  if (images.length > 0) {
    const { data: rawImageUrl } = await supabaseClient.storage
      .from('images')
      .createSignedUrl(`${userId}/${conversationId}/${images[0]}`, 60 * 60);

    if (!rawImageUrl?.signedUrl) {
      throw new Error('No image URL from Flux');
    }

    imageUrl = reformatSignedUrl(rawImageUrl.signedUrl);
  }

  const input = {
    prompt: prompt
      ? `${INSTRUCTIONS_3D} ${prompt}`
      : `${INSTRUCTIONS_3D} No prompt provided`,
    ...(imageUrl && { image_prompt: imageUrl }),
    width: 1024,
    height: 1024,
    prompt_upsampling: true,
    guidance: 3,
    safety_tolerance: 6,
    output_format: 'png',
    raw: true,
  };

  const output = await replicateClient.run('black-forest-labs/flux-1.1-pro', {
    input,
  });

  const imageBytes = output as FileOutput;
  return imageBytes;
};
*/
