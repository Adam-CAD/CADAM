import { Buffer } from 'node:buffer';
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.9';
import { GoogleGenAI, Modality } from 'npm:@google/genai';
import { fal } from 'npm:@fal-ai/client';
import { reformatSignedUrl } from './messageUtils.ts';
import { safeFetch } from './safeFetch.ts';

const DEBUG_LOGS =
  Deno.env.get('ENVIRONMENT') === 'local' ||
  Deno.env.get('DEBUG_LOGS') === 'true';
const debugLog = (...args: unknown[]) => {
  if (DEBUG_LOGS) console.log(...args);
};

// Shared 3D model generation instructions for consistency across all image generation services
const INSTRUCTIONS_3D =
  'You are generating a fully textured and rendered 3D model. Output one centered 3D model or multiple centered objects, no text. Plain white background (or an empty background which provides optimal contrast with the textures of the 3D model), neutral lighting, and a soft shadow directly under the 3D model. Keep the entire object fully in-frame with 5–10% padding; no cropping. Make sure the description strongly impacts the form and shape of the 3D Model not just the surface texture';

fal.config({
  credentials: Deno.env.get('FAL_KEY') ?? '',
});

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

    imagePart = {
      inlineData: {
        mimeType: 'image/png',
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
      .map((image) => reformatSignedUrl(image.signedUrl));
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
    const response = await safeFetch(imageUrl.url, {
      maxBytes: 20 * 1024 * 1024,
      timeoutMs: 30000,
    });
    const imageBytes = await response.arrayBuffer();
    return Buffer.from(imageBytes);
  } else {
    const result = await fal.run('fal-ai/flux-pro/v1.1', {
      input: {
        prompt: enhancedPrompt,
        enable_safety_checker: false,
        safety_tolerance: '6',
      },
    });

    const imageUrl = result.data.images[0];
    const response = await safeFetch(imageUrl.url, {
      maxBytes: 20 * 1024 * 1024,
      timeoutMs: 30000,
    });
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

/**
 * Generates an image using Gemini 3.1 Flash Image Preview directly via Google GenAI.
 * Best for initial text-to-image generation for 3D models.
 */
export const generateImageWithGeminiFlash = async (
  googleGenAI: GoogleGenAI,
  prompt: string,
): Promise<Buffer> => {
  debugLog('Generating image with gemini-3.1-flash-image-preview');

  const result = await googleGenAI.models.generateContent({
    model: 'gemini-3.1-flash-image-preview',
    contents: [{ text: prompt }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  if (!result.candidates?.[0]?.content?.parts) {
    throw new Error('No result from Gemini 3.1 Flash Image Preview');
  }

  let generatedImageData: string | undefined;
  for (const part of result.candidates[0].content.parts) {
    if (part.inlineData) {
      generatedImageData = part.inlineData.data;
    }
  }

  if (!generatedImageData) {
    throw new Error('No image data from Gemini 3.1 Flash Image Preview');
  }

  const imageBytes = Buffer.from(generatedImageData, 'base64');
  debugLog('Successfully generated image with gemini-3.1-flash-image-preview');

  return imageBytes;
};

/**
 * Edits an image using Gemini 3.1 Flash Image Preview directly via Google GenAI.
 * Best for editing existing images or uploaded images for 3D model generation.
 */
export const generateImageWithGeminiFlashEdit = async (
  googleGenAI: GoogleGenAI,
  prompt: string,
  imageUrl: string,
): Promise<Buffer> => {
  debugLog('Editing image with gemini-3.1-flash-image-preview');
  debugLog('Input image URL:', imageUrl);
  debugLog('Prompt:', prompt);

  try {
    const imageResponse = await safeFetch(imageUrl, {
      maxBytes: 20 * 1024 * 1024,
      timeoutMs: 30000,
    });
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch input image: ${imageResponse.status}`);
    }

    const imageArrayBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageArrayBuffer).toString('base64');

    const result = await googleGenAI.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: [
        { text: prompt },
        {
          inlineData: {
            mimeType: 'image/png',
            data: base64Image,
          },
        },
      ],
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });

    if (!result.candidates?.[0]?.content?.parts) {
      throw new Error('No result from Gemini 3.1 Flash Image Preview edit');
    }

    let generatedImageData: string | undefined;
    for (const part of result.candidates[0].content.parts) {
      if (part.inlineData) {
        generatedImageData = part.inlineData.data;
      }
    }

    if (!generatedImageData) {
      throw new Error('No image data from Gemini 3.1 Flash Image Preview edit');
    }

    const imageBytes = Buffer.from(generatedImageData, 'base64');
    debugLog('Successfully edited image with gemini-3.1-flash-image-preview');

    return imageBytes;
  } catch (error) {
    debugLog('Error in generateImageWithGeminiFlashEdit:', error);
    throw error;
  }
};
