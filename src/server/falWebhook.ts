import { unzipSync } from 'fflate';
import { env } from './env';
import { getServiceRoleSupabaseClient } from './supabaseClient';
import { isRecord } from './api';

const DEBUG_LOGS =
  env('ENVIRONMENT') === 'local' || env('DEBUG_LOGS') === 'true';
const debugLog = (...args: unknown[]) => {
  if (DEBUG_LOGS) console.log(...args);
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown) {
  return error instanceof Error ? error.stack : undefined;
}

function errorName(error: unknown) {
  if (error instanceof Error) return error.name;
  if (isRecord(error) && typeof error.name === 'string') return error.name;
  return undefined;
}

export async function handleFalWebhookRequest(request: Request) {
  const supabaseClient = getServiceRoleSupabaseClient();

  debugLog('=== FAL WEBHOOK CALLED ===');
  debugLog('Webhook request received:', {
    method: request.method,
    url: request.url,
    timestamp: new Date().toISOString(),
  });

  const searchParams = new URL(request.url).searchParams;
  const id = searchParams.get('id');
  const mode = searchParams.get('mode');

  debugLog('Webhook parameters:', { id, mode });

  if (!id) {
    console.error('Webhook missing mesh ID');
    return new Response('Missing mesh ID', { status: 200 });
  }

  // Validate that the ID is a valid UUID
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    console.error('Invalid mesh ID format:', id);
    return new Response('Invalid mesh ID format', { status: 200 });
  }

  debugLog('=== QUERYING MESH DATA ===');
  const { data: meshData } = await supabaseClient
    .from(mode === 'preview' ? 'previews' : 'meshes')
    .select('*')
    .eq('id', id)
    .limit(1)
    .maybeSingle();

  debugLog('Mesh data found:', {
    found: !!meshData,
    status: meshData?.status,
    id: meshData?.id,
  });

  if (!meshData) {
    console.error('Mesh not found in database:', id);
    return new Response('Mesh not found', { status: 200 });
  }

  if (meshData.status !== 'pending') {
    debugLog('Mesh already processed:', { status: meshData.status, id });
    return new Response('Mesh already uploaded', { status: 200 });
  }

  let meshStatus: 'success' | 'failure' = 'success';
  try {
    const body = await request.json();

    debugLog('Webhook received body:', {
      id,
      mode,
      status: body.status,
      hasPayload: !!body.payload,
      bodyKeys: Object.keys(body),
    });

    const status = body.status;

    if (status !== 'OK') {
      console.error('Webhook received non-OK status:', {
        status,
        body: JSON.stringify(body, null, 2),
      });
      throw new Error(`Mesh failed with status: ${status}`);
    }

    const payload = body.payload;

    // Log the payload structure to understand what the API returns
    debugLog('=== WEBHOOK PAYLOAD STRUCTURE ===');
    debugLog('Payload keys:', Object.keys(payload));
    debugLog(
      'Full payload (truncated URLs):',
      JSON.stringify(
        payload,
        (_key, value) => {
          if (typeof value === 'string' && value.startsWith('http')) {
            return value.substring(0, 80) + '...';
          }
          return value;
        },
        2,
      ),
    );

    debugLog('Payload has model_mesh?', !!payload.model_mesh);
    debugLog('Payload has base_model?', !!payload.base_model);
    debugLog('Payload has pbr_model?', !!payload.pbr_model);
    debugLog('Payload has model?', !!payload.model);
    debugLog('Payload has mesh?', !!payload.mesh);
    debugLog('Payload has model_glb?', !!payload.model_glb);
    debugLog('Payload has model_urls?', !!payload.model_urls);
    debugLog('Payload has output_glb?', !!payload.output_glb);
    debugLog('Payload has glb?', !!payload.glb);
    debugLog('Payload has textured_glb?', !!payload.textured_glb);

    // Log nested structure if exists
    if (payload.model_mesh) {
      debugLog('model_mesh keys:', Object.keys(payload.model_mesh));
    }
    if (payload.base_model) {
      debugLog('base_model keys:', Object.keys(payload.base_model));
    }
    if (payload.pbr_model) {
      debugLog('pbr_model keys:', Object.keys(payload.pbr_model));
    }
    if (payload.model_glb) {
      debugLog('model_glb keys:', Object.keys(payload.model_glb));
    }
    if (payload.output_glb) {
      debugLog('output_glb keys:', Object.keys(payload.output_glb));
    }
    if (payload.glb) {
      debugLog(
        'glb keys:',
        typeof payload.glb === 'object' ? Object.keys(payload.glb) : 'string',
      );
    }
    if (payload.textured_glb) {
      debugLog(
        'textured_glb keys:',
        typeof payload.textured_glb === 'object'
          ? Object.keys(payload.textured_glb)
          : 'string',
      );
    }

    let modelUrl: string;

    // Handle different model response formats
    if (payload.model_glb?.url) {
      // SAM 3D Objects, Meshy v6, Hunyuan v3.1 Pro format
      debugLog('Using model_glb.url:', payload.model_glb.url);
      modelUrl = payload.model_glb.url;
    } else if (payload.model_urls?.glb?.url) {
      // Meshy v6 / Hunyuan v3.1 Pro alternative format
      debugLog('Using model_urls.glb.url:', payload.model_urls.glb.url);
      modelUrl = payload.model_urls.glb.url;
    } else if (payload.textured_glb?.url) {
      // Rodin v2 textured GLB format
      debugLog('Using textured_glb.url:', payload.textured_glb.url);
      modelUrl = payload.textured_glb.url;
    } else if (payload.output_glb?.url) {
      // Rodin v2 output GLB format
      debugLog('Using output_glb.url:', payload.output_glb.url);
      modelUrl = payload.output_glb.url;
    } else if (payload.glb?.url) {
      // Generic GLB format
      debugLog('Using glb.url:', payload.glb.url);
      modelUrl = payload.glb.url;
    } else if (typeof payload.glb === 'string') {
      // Direct GLB URL string
      debugLog('Using glb (string):', payload.glb);
      modelUrl = payload.glb;
    } else if (payload.model_mesh?.url) {
      // Tripo v2.5 and Trellis format
      debugLog('Using model_mesh.url:', payload.model_mesh.url);
      modelUrl = payload.model_mesh.url;
    } else if (payload.base_model?.url) {
      // Tripo v2.5 with texture='no' (textureless)
      debugLog('Using base_model.url (textureless):', payload.base_model.url);
      modelUrl = payload.base_model.url;
    } else if (payload.pbr_model?.url) {
      // Tripo v2.5 with PBR enabled
      debugLog('Using pbr_model.url:', payload.pbr_model.url);
      modelUrl = payload.pbr_model.url;
    } else if (payload.model?.url) {
      // Hunyuan format
      debugLog('Using model.url:', payload.model.url);
      modelUrl = payload.model.url;
    } else if (payload.mesh?.url) {
      // Alternative format
      debugLog('Using mesh.url:', payload.mesh.url);
      modelUrl = payload.mesh.url;
    } else {
      console.error(
        'Unknown response format. Available fields:',
        Object.keys(payload),
      );
      console.error(
        'Full payload structure:',
        JSON.stringify(payload, null, 2),
      );
      throw new Error('No model URL found in response');
    }

    debugLog('=== FETCHING MODEL ===');
    debugLog('Model URL:', modelUrl);

    // Add timeout to prevent hanging - increased to 45 seconds for large models
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 second timeout

    let model: ArrayBuffer;
    try {
      const modelResponse = await fetch(modelUrl, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!modelResponse.ok) {
        console.error('Model fetch failed:', {
          status: modelResponse.status,
          statusText: modelResponse.statusText,
        });
        throw new Error(
          `Failed to fetch model: ${modelResponse.status} ${modelResponse.statusText}`,
        );
      }

      debugLog('Model fetched successfully, converting to arrayBuffer...');
      model = await modelResponse.arrayBuffer();
      debugLog('Model size:', model.byteLength, 'bytes');
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (errorName(fetchError) === 'AbortError') {
        throw new Error('Model fetch timed out after 45 seconds');
      }
      throw fetchError;
    }

    // Handle ZIP files (Seed3D returns models in a zip archive)
    if (modelUrl.endsWith('.zip')) {
      debugLog('=== EXTRACTING GLB FROM ZIP ===');
      try {
        const zipData = new Uint8Array(model);
        const unzipped = unzipSync(zipData);

        // Find the GLB file in the zip
        const glbFilename = Object.keys(unzipped).find(
          (name) => name.endsWith('.glb') || name.endsWith('.GLB'),
        );

        if (!glbFilename) {
          debugLog('Available files in zip:', Object.keys(unzipped));
          throw new Error('No GLB file found in zip archive');
        }

        debugLog('Found GLB in zip:', glbFilename);
        const glbData = unzipped[glbFilename];
        // Create a proper ArrayBuffer from the Uint8Array (not a view)
        model = glbData.buffer.slice(
          glbData.byteOffset,
          glbData.byteOffset + glbData.byteLength,
        );
        debugLog('Extracted GLB size:', model.byteLength, 'bytes');
      } catch (zipError) {
        console.error('Failed to extract GLB from zip:', zipError);
        throw new Error(
          `Failed to extract GLB from zip: ${errorMessage(zipError)}`,
        );
      }
    }

    // Determine file extension and content type based on stored file_type
    const fileExtension = 'file_type' in meshData ? meshData.file_type : 'glb';
    const contentType =
      fileExtension === 'fbx'
        ? 'application/octet-stream'
        : 'model/gltf-binary';

    const { error: uploadError } = await supabaseClient.storage
      .from(mode === 'preview' ? 'previews' : 'meshes')
      .upload(
        `${meshData.user_id}/${meshData.conversation_id}/${id}.${fileExtension}`,
        model,
        {
          contentType,
        },
      );

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { error: updateError } =
      mode === 'preview'
        ? await supabaseClient
            .from('previews')
            .update({ status: 'success' })
            .eq('id', id)
        : await supabaseClient
            .from('meshes')
            .update({ status: 'success', file_type: fileExtension })
            .eq('id', id);

    if (updateError) {
      console.error('Failed to update mesh status:', updateError);
      throw new Error(updateError.message);
    }

    meshStatus = 'success';

    // No manual cleanup needed - multiview images auto-expire

    debugLog('=== WEBHOOK SUCCESS ===');
    debugLog('Successfully processed mesh:', {
      id,
      mode,
      fileExtension,
      status: meshStatus,
    });
  } catch (error) {
    console.error('Error processing fal webhook', error);
    console.error('Webhook error details:', {
      id,
      mode,
      error: errorMessage(error),
      stack: errorStack(error),
      meshDataStatus: meshData?.status,
    });

    meshStatus = 'failure';

    await supabaseClient
      .from(mode === 'preview' ? 'previews' : 'meshes')
      .update({
        status: meshStatus,
      })
      .eq('id', id);
  }

  debugLog('=== SENDING BROADCAST ===');
  debugLog('Event:', 'mesh-updated');
  debugLog('Mesh ID:', id);

  const channel = supabaseClient.channel(`mesh-updates-${meshData.user_id}`);
  const broadcastResult = await channel.send({
    type: 'broadcast',
    event: 'mesh-updated',
    payload: {
      kind: mode === 'preview' ? 'preview' : 'mesh',
      id,
      status: meshStatus,
      conversation_id: meshData.conversation_id,
    },
  });

  debugLog('Broadcast result:', broadcastResult);

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
