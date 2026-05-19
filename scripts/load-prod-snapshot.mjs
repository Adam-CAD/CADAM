#!/usr/bin/env node
// One-off loader for the production conversations + messages snapshot into
// a freshly-reset local Supabase. The schema lives in the migration at
// supabase/migrations/20260518000000_parametric_ai_sdk_parts.sql — that's
// where `_content_to_parts_v1` and the parts/metadata backfill UPDATE come
// from. This script just gets the CSV bytes into the database and then
// re-fires the same backfill UPDATE so the new rows pick up parts/metadata.
//
// Usage:  NODE_PATH=/tmp/node_modules node scripts/load-prod-snapshot.mjs

import { createReadStream, createWriteStream, mkdirSync, existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { parse as parseStream } from 'csv-parse';
import { spawn } from 'child_process';

const PG_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const RAW_CONVS = '/Users/dylan-at-adam/Downloads/migration_work/conversations_raw.csv';
const RAW_MSGS_CLEAN = '/Users/dylan-at-adam/Downloads/migration_work/messages_clean.csv';
const WORK = '/tmp/cadam_load';
if (!existsSync(WORK)) mkdirSync(WORK, { recursive: true });

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '', err = '';
    p.stdout?.on('data', (c) => (out += c.toString()));
    p.stderr?.on('data', (c) => (err += c.toString()));
    p.on('close', (code) => {
      if (code !== 0) reject(new Error(`${cmd} ${args.slice(0,3).join(' ')} exited ${code}: ${err}\n${out}`));
      else resolve({ out, err });
    });
    p.on('error', reject);
  });
}

function psql(sql) {
  return run('psql', [PG_URL, '-v', 'ON_ERROR_STOP=1', '-c', sql]);
}

function psqlFile(path) {
  return run('psql', [PG_URL, '-v', 'ON_ERROR_STOP=1', '-f', path]);
}

async function step(label, fn) {
  const t = Date.now();
  process.stdout.write(`[${label}] starting...\n`);
  const res = await fn();
  process.stdout.write(`[${label}] done in ${((Date.now() - t) / 1000).toFixed(1)}s\n`);
  return res;
}

// 1. Scan conversations CSV → unique user_ids. The CSV columns already
//    match the target table, so we'll \copy from the original file later.
const userIds = new Set();
const conversationIds = new Set();
await step('scan conversations for user_ids', async () => {
  const parser = createReadStream(RAW_CONVS).pipe(parseStream({ columns: true, relax_quotes: true }));
  let n = 0;
  for await (const row of parser) {
    if (row.user_id) userIds.add(row.user_id);
    if (row.id) conversationIds.add(row.id);
    n++;
    if (n % 25000 === 0) process.stdout.write(`  rows=${n} distinct_users=${userIds.size}\n`);
  }
  process.stdout.write(`  total conversations=${n}, distinct user_ids=${userIds.size}\n`);
});

// 2. Generate auth.users SQL.
await step('write auth.users SQL', async () => {
  const out = createWriteStream(`${WORK}/auth_users.sql`);
  out.write(`-- Auto-generated dummy auth.users so FK references resolve.\n`);
  out.write(`SET session_replication_role = replica;\n`); // silence on_auth_user_created trigger
  let i = 0;
  for (const id of userIds) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) continue;
    out.write(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token) VALUES ('00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated', 'u_${id}@local.invalid', '', now(), '{"provider":"email"}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '') ON CONFLICT (id) DO NOTHING;\n`
    );
    i++;
  }
  out.write(`SET session_replication_role = DEFAULT;\n`);
  out.end();
  await new Promise((r) => out.on('close', r));
  process.stdout.write(`  wrote ${i} INSERT statements\n`);
});

// 3. Apply auth.users.
await step('create auth.users', () => psqlFile(`${WORK}/auth_users.sql`));

await step('truncate target tables', () => psql(
  `SET session_replication_role = replica; TRUNCATE public.messages, public.conversations RESTART IDENTITY CASCADE; SET session_replication_role = DEFAULT;`
));

// 4. Stream raw CSVs into PostgreSQL with native \copy.
//    - replica-mode silences update_leaf_trigger (otherwise the leaf-pointer
//      update fires once per inserted message, dragging the load to a crawl).
//    - we drop the existing indexes on `messages` before COPY and recreate
//      them after, so PostgreSQL doesn't maintain them inline.
await step('drop messages indexes', () => psql(
  `DROP INDEX IF EXISTS public.messages_conversation_id_idx;`
));

// `\copy` is a psql client-side meta-command; it can only run from stdin
// or a -f script, not from -c. Emit one tiny SQL script per table.
function copySql(table, columns, file) {
  return `SET session_replication_role = replica;\n\\copy public.${table} (${columns.join(', ')}) FROM '${file}' WITH (FORMAT csv, HEADER true);\n`;
}

await step('\\copy conversations', async () => {
  const sqlPath = `${WORK}/copy_conversations.sql`;
  await writeFile(sqlPath, copySql('conversations',
    ['id','created_at','user_id','title','type','privacy','current_message_leaf_id','settings','updated_at'],
    RAW_CONVS));
  return psqlFile(sqlPath);
});

await step('\\copy messages', async () => {
  const sqlPath = `${WORK}/copy_messages.sql`;
  await writeFile(sqlPath, copySql('messages',
    ['id','created_at','conversation_id','role','content','rating','parent_message_id'],
    RAW_MSGS_CLEAN));
  return psqlFile(sqlPath);
});

await step('recreate messages indexes', () => psql(
  `CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON public.messages USING btree (conversation_id);`
));

// 5. Backfill parts/metadata.
await step('backfill parts + metadata', () => psql(
  `UPDATE public.messages m
     SET parts    = public._content_to_parts_v1(m.id, m.role, m.content, c.user_id, c.id),
         metadata = public._content_to_metadata_v1(m.content)
    FROM public.conversations c
   WHERE c.id = m.conversation_id
     AND m.content IS NOT NULL
     AND m.parts = '[]'::jsonb;`
));

// 6. Verify counts and spot-check.
await step('verify counts', async () => {
  const { out } = await psql(
    `SELECT (SELECT count(*) FROM public.conversations) AS conv_n,
            (SELECT count(*) FROM public.messages) AS msg_n,
            (SELECT count(*) FROM public.messages WHERE jsonb_array_length(parts) > 0) AS msg_with_parts,
            (SELECT count(*) FROM public.messages WHERE content IS NOT NULL AND jsonb_array_length(parts) = 0) AS msg_empty_parts;`
  );
  process.stdout.write(out);
});

process.stdout.write('Load complete.\n');
