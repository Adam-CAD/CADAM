-- Add the new AI-SDK-shaped columns to messages. `parts` is a discriminated
-- union of AI SDK UI parts (`{type:'text',...}`, `{type:'tool-...'}`, etc.);
-- `metadata` carries per-message bookkeeping like the `model` that generated
-- the response. Both default to JSON literals so existing/new rows that
-- haven't been backfilled stay valid.
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS parts jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Helper that maps a legacy `content` JSON object onto the new AI SDK
-- `parts` array. Mirrors the client-side transform implied by
-- src/lib/aiMessages.ts and src/components/chat/MessageBubble.tsx:
--   user content {text, images, mesh, meshTopology, polygonCount, ...}
--       -> text part, file parts (one per imageId),
--          data-mesh-context, data-mesh-preferences
--   assistant content {text, artifact, mesh, images, toolCalls, ...}
--       -> text part,
--          tool-build_parametric_model (from artifact / failed toolCalls),
--          tool-create_mesh (from mesh),
--          file parts (legacy create_image tool output)
-- Tool call ids are reused from the original toolCalls entry when present
-- and fall back to a deterministic synthesized id keyed on the message uuid
-- so re-running the backfill produces identical output.
CREATE OR REPLACE FUNCTION public._content_to_parts_v1(
  p_message_id uuid,
  p_role text,
  p_content jsonb,
  p_user_id uuid,
  p_conversation_id uuid
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  parts jsonb := '[]'::jsonb;
  txt text;
  imgs jsonb;
  img text;
  tcs jsonb;
  art jsonb;
  msh jsonb;
  bb jsonb;
  meshfn text;
  bp_id text;
  cm_id text;
  failed_id text;
  failed_err text;
BEGIN
  IF p_content IS NULL OR jsonb_typeof(p_content) <> 'object' THEN
    RETURN '[]'::jsonb;
  END IF;

  IF p_role = 'user' THEN
    txt := p_content->>'text';
    IF txt IS NOT NULL AND txt <> '' THEN
      parts := parts || jsonb_build_array(jsonb_build_object('type','text','text',txt));
    END IF;

    imgs := p_content->'images';
    IF jsonb_typeof(imgs) = 'array' THEN
      FOR img IN SELECT jsonb_array_elements_text(imgs) LOOP
        -- Production image storage path is `${user_id}/${conv_id}/${imageId}`
        -- with NO extension — both legacy and new code use that format
        -- (see src/components/TextAreaChat.tsx upload, and master
        -- src/server/imageGen.ts download paths). filename keeps the `.png`
        -- suffix to match the new client's display convention; the actual
        -- bytes can be any image type (gpt-image-2 stored jpeg, user uploads
        -- vary). Renderers that need the real MIME should read it off the
        -- response blob, the same way generateImageWithGeminiMultiTurn does.
        parts := parts || jsonb_build_array(jsonb_build_object(
          'type','file',
          'mediaType','image/png',
          'filename', img || '.png',
          'url', '/storage/v1/object/public/images/' || p_user_id::text || '/' || p_conversation_id::text || '/' || img
        ));
      END LOOP;
    END IF;

    msh := p_content->'mesh';
    IF jsonb_typeof(msh) = 'object' AND (msh->>'id') IS NOT NULL THEN
      bb := p_content->'meshBoundingBox';
      meshfn := p_content->>'meshFilename';
      parts := parts || jsonb_build_array(jsonb_build_object(
        'type','data-mesh-context',
        'data', jsonb_strip_nulls(jsonb_build_object(
          'meshId', msh->>'id',
          'fileType', COALESCE(msh->>'fileType','glb'),
          'filename', meshfn,
          'boundingBox', bb
        ))
      ));
    END IF;

    IF (p_content ? 'meshTopology') OR (p_content ? 'polygonCount') THEN
      parts := parts || jsonb_build_array(jsonb_build_object(
        'type','data-mesh-preferences',
        'data', jsonb_build_object(
          'topology', COALESCE(p_content->>'meshTopology','polys'),
          'polygonCount', COALESCE(NULLIF(p_content->>'polygonCount','')::int, 100000)
        )
      ));
    END IF;

    RETURN parts;
  END IF;

  IF p_role = 'assistant' THEN
    txt := p_content->>'text';
    IF txt IS NOT NULL AND txt <> '' THEN
      parts := parts || jsonb_build_array(jsonb_build_object('type','text','text',txt,'state','done'));
    END IF;

    tcs := p_content->'toolCalls';
    art := p_content->'artifact';
    IF jsonb_typeof(art) = 'object' THEN
      bp_id := NULL;
      IF jsonb_typeof(tcs) = 'array' THEN
        SELECT tc->>'id' INTO bp_id
          FROM jsonb_array_elements(tcs) AS tc
          WHERE tc->>'name' = 'build_parametric_model' AND (tc->>'id') IS NOT NULL
          LIMIT 1;
      END IF;
      bp_id := COALESCE(bp_id, 'tool_legacy_bp_' || p_message_id::text);
      parts := parts || jsonb_build_array(jsonb_build_object(
        'type','tool-build_parametric_model',
        'toolCallId', bp_id,
        'state','output-available',
        'input', jsonb_build_object(
          'title', COALESCE(NULLIF(art->>'title',''),'Untitled'),
          'version', COALESCE(NULLIF(art->>'version',''),'v1'),
          'code', COALESCE(art->>'code','')
        ),
        'output', jsonb_build_object('status','success','message','')
      ));
    ELSE
      -- No artifact landed but a build_parametric_model tool call was
      -- attempted and failed. Surface as an output-error tool part so the
      -- UI still draws the failure banner.
      IF jsonb_typeof(tcs) = 'array' THEN
        SELECT tc->>'id', tc->>'error' INTO failed_id, failed_err
          FROM jsonb_array_elements(tcs) AS tc
          WHERE tc->>'name' = 'build_parametric_model'
            AND tc->>'status' = 'error'
          LIMIT 1;
        IF failed_id IS NOT NULL THEN
          parts := parts || jsonb_build_array(jsonb_build_object(
            'type','tool-build_parametric_model',
            'toolCallId', failed_id,
            'state','output-error',
            'errorText', COALESCE(NULLIF(failed_err,''),'CAD generation failed')
          ));
        END IF;
      END IF;
    END IF;

    msh := p_content->'mesh';
    IF jsonb_typeof(msh) = 'object' AND (msh->>'id') IS NOT NULL THEN
      cm_id := NULL;
      IF jsonb_typeof(tcs) = 'array' THEN
        SELECT tc->>'id' INTO cm_id
          FROM jsonb_array_elements(tcs) AS tc
          WHERE tc->>'name' = 'create_mesh' AND (tc->>'id') IS NOT NULL
          LIMIT 1;
      END IF;
      cm_id := COALESCE(cm_id, msh->>'id');
      parts := parts || jsonb_build_array(jsonb_build_object(
        'type','tool-create_mesh',
        'toolCallId', cm_id,
        'state','output-available',
        'input', '{}'::jsonb,
        'output', jsonb_build_object(
          'id', msh->>'id',
          'fileType', COALESCE(msh->>'fileType','glb')
        )
      ));
    END IF;

    -- Legacy create_image tool outputs landed as bare imageId arrays in
    -- content.images on assistant rows. Preserve them as `file` parts so
    -- the data isn't lost even though the new MessageBubble doesn't yet
    -- render assistant-side image parts. Storage path has no extension —
    -- see the user-message branch above for rationale.
    imgs := p_content->'images';
    IF jsonb_typeof(imgs) = 'array' THEN
      FOR img IN SELECT jsonb_array_elements_text(imgs) LOOP
        parts := parts || jsonb_build_array(jsonb_build_object(
          'type','file',
          'mediaType','image/png',
          'filename', img || '.png',
          'url', '/storage/v1/object/public/images/' || p_user_id::text || '/' || p_conversation_id::text || '/' || img
        ));
      END LOOP;
    END IF;

    RETURN parts;
  END IF;

  RETURN '[]'::jsonb;
END;
$$;

-- Metadata mirrors AppUIMessage['metadata'] = {model?, billingTokens?}.
-- Only `model` is preserved from legacy content; the billing field was
-- introduced after this schema and starts empty.
CREATE OR REPLACE FUNCTION public._content_to_metadata_v1(
  p_content jsonb
) RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_content IS NULL OR jsonb_typeof(p_content) <> 'object' THEN '{}'::jsonb
    ELSE jsonb_strip_nulls(jsonb_build_object('model', p_content->>'model'))
  END;
$$;

-- Backfill any legacy rows that still carry their payload in `content`.
-- Idempotent: only touches rows where `parts` is still the default empty
-- array AND `content` has data to convert, so a re-run is a no-op.
UPDATE public.messages m
SET parts = public._content_to_parts_v1(m.id, m.role, m.content, c.user_id, c.id),
    metadata = public._content_to_metadata_v1(m.content)
FROM public.conversations c
WHERE c.id = m.conversation_id
  AND m.content IS NOT NULL
  AND m.parts = '[]'::jsonb;

-- content column is intentionally retained for legacy conversations (a
-- follow-up read-only display path will use it). New messages persist their
-- payload in `parts` instead, so the NOT NULL constraint on `content` has
-- to be dropped or every insert from the new code path fails with
-- `null value in column "content" violates not-null constraint`.
ALTER TABLE public.messages
ALTER COLUMN content DROP NOT NULL;

-- With `content` now nullable and `parts` defaulting to `[]`, an INSERT
-- that supplies neither would land as a record with no actual payload.
-- Require at least one populated payload column.
ALTER TABLE public.messages
DROP CONSTRAINT IF EXISTS messages_payload_present;

ALTER TABLE public.messages
ADD CONSTRAINT messages_payload_present
CHECK (jsonb_array_length(parts) > 0 OR content IS NOT NULL);

ALTER TABLE public.conversations
DROP COLUMN IF EXISTS legacy;

-- Atomic write for `conversations.settings.suggestions`. The chat server
-- previously read settings, merged the new suggestions array client-side,
-- and wrote the whole object back — which under concurrent assistant
-- turns (e.g. two parallel branches finishing close together) could
-- silently drop the other update. `jsonb_set` runs in one statement so
-- only the `suggestions` key is touched and other settings (model, etc.)
-- stay intact.
CREATE OR REPLACE FUNCTION public.set_conversation_suggestions(
  p_conversation_id uuid,
  p_suggestions jsonb
) RETURNS void LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
  UPDATE public.conversations
  SET settings = jsonb_set(
    COALESCE(settings, '{}'::jsonb),
    '{suggestions}',
    p_suggestions,
    true
  )
  WHERE id = p_conversation_id;
$$;
