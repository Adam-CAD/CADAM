CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "parts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "content" "jsonb",
    "rating" smallint DEFAULT '0'::smallint NOT NULL,
    "parent_message_id" "uuid",
    CONSTRAINT "messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text"]))),
    CONSTRAINT "messages_payload_present" CHECK ((jsonb_array_length("parts") > 0) OR ("content" IS NOT NULL))
);


CREATE UNIQUE INDEX IF NOT EXISTS messages_pkey ON "public"."messages" USING btree (id);

ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_pkey" PRIMARY KEY USING INDEX "messages_pkey";

ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE not valid;

ALTER TABLE "public"."messages" VALIDATE CONSTRAINT "messages_conversation_id_fkey";


CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON "public"."messages" USING btree (conversation_id);


CREATE POLICY "Public conversations messages" ON "public"."messages" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "messages"."conversation_id") AND ("conversations"."privacy" = 'public'::"public"."privacy_type")))));

CREATE POLICY "Users can manage messages in their conversations" ON "public"."messages" USING (((SELECT "auth"."uid"()) IN ( SELECT "conversations"."user_id"
   FROM "public"."conversations"
  WHERE ("conversations"."id" = "messages"."conversation_id"))));

ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;
