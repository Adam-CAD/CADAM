-- AgentPond writes trace batches with a server-only Supabase secret.
-- Keeping the bucket private prevents browser clients from reading prompts
-- and model responses through the Storage API.
insert into storage.buckets (id, name, public)
values ('agentpond', 'agentpond', false)
on conflict (id) do update
set public = false;
