create extension if not exists vector;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  youtube_url text not null,
  youtube_video_id text not null,
  title text,
  thumbnail_url text,
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'needs_transcript', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, youtube_video_id)
);

create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  content text not null,
  source text not null default 'manual' check (source in ('youtube', 'manual')),
  created_at timestamptz not null default now()
);

create table if not exists public.summaries (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references public.videos(id) on delete cascade,
  summary text not null,
  keywords text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.video_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.openai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  feature text not null,
  model text not null,
  input_size_estimate integer not null default 0,
  output_size_estimate integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists videos_user_id_idx on public.videos(user_id);
create index if not exists transcripts_video_id_idx on public.transcripts(video_id);
create index if not exists summaries_video_id_idx on public.summaries(video_id);
create index if not exists video_chunks_user_id_idx on public.video_chunks(user_id);
create index if not exists video_chunks_video_id_idx on public.video_chunks(video_id);
create index if not exists video_chunks_embedding_idx
  on public.video_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
create index if not exists openai_usage_logs_user_id_idx
  on public.openai_usage_logs(user_id);
create index if not exists openai_usage_logs_created_at_idx
  on public.openai_usage_logs(created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists videos_set_updated_at on public.videos;
create trigger videos_set_updated_at
before update on public.videos
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

drop function if exists public.match_video_chunks(vector, uuid, int);
create or replace function public.match_video_chunks(
  query_embedding vector(1536),
  match_user_id uuid,
  match_count int default 6
)
returns table (
  id uuid,
  video_id uuid,
  title text,
  youtube_url text,
  created_at timestamptz,
  content text,
  summary text,
  keywords text[],
  similarity double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    vc.id,
    vc.video_id,
    v.title,
    v.youtube_url,
    v.created_at,
    vc.content,
    s.summary,
    s.keywords,
    1 - (vc.embedding <=> query_embedding) as similarity
  from public.video_chunks vc
  join public.videos v on v.id = vc.video_id
  left join public.summaries s on s.video_id = v.id
  where vc.user_id = match_user_id
    and match_user_id = auth.uid()
  order by vc.embedding <=> query_embedding
  limit match_count;
$$;

alter table public.users enable row level security;
alter table public.videos enable row level security;
alter table public.transcripts enable row level security;
alter table public.summaries enable row level security;
alter table public.video_chunks enable row level security;
alter table public.openai_usage_logs enable row level security;

drop policy if exists "Users can read own row" on public.users;
create policy "Users can read own row"
on public.users for select
using (auth.uid() = id);

drop policy if exists "Users can insert own row" on public.users;
create policy "Users can insert own row"
on public.users for insert
with check (auth.uid() = id);

drop policy if exists "Users can update own row" on public.users;
create policy "Users can update own row"
on public.users for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can manage own videos" on public.videos;
create policy "Users can manage own videos"
on public.videos for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read own transcripts" on public.transcripts;
create policy "Users can read own transcripts"
on public.transcripts for select
using (
  exists (
    select 1 from public.videos
    where videos.id = transcripts.video_id
      and videos.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert own transcripts" on public.transcripts;
create policy "Users can insert own transcripts"
on public.transcripts for insert
with check (
  exists (
    select 1 from public.videos
    where videos.id = transcripts.video_id
      and videos.user_id = auth.uid()
  )
);

drop policy if exists "Users can delete own transcripts" on public.transcripts;
create policy "Users can delete own transcripts"
on public.transcripts for delete
using (
  exists (
    select 1 from public.videos
    where videos.id = transcripts.video_id
      and videos.user_id = auth.uid()
  )
);

drop policy if exists "Users can read own summaries" on public.summaries;
create policy "Users can read own summaries"
on public.summaries for select
using (
  exists (
    select 1 from public.videos
    where videos.id = summaries.video_id
      and videos.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert own summaries" on public.summaries;
create policy "Users can insert own summaries"
on public.summaries for insert
with check (
  exists (
    select 1 from public.videos
    where videos.id = summaries.video_id
      and videos.user_id = auth.uid()
  )
);

drop policy if exists "Users can delete own summaries" on public.summaries;
create policy "Users can delete own summaries"
on public.summaries for delete
using (
  exists (
    select 1 from public.videos
    where videos.id = summaries.video_id
      and videos.user_id = auth.uid()
  )
);

drop policy if exists "Users can manage own chunks" on public.video_chunks;
create policy "Users can manage own chunks"
on public.video_chunks for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read own usage logs" on public.openai_usage_logs;
create policy "Users can read own usage logs"
on public.openai_usage_logs for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own usage logs" on public.openai_usage_logs;
create policy "Users can insert own usage logs"
on public.openai_usage_logs for insert
with check (auth.uid() = user_id);
