-- Preview-only rollout first. Not automatically executed by the application.
-- Next.js authenticates every request. Only service_role can execute the RPCs;
-- all direct table access is revoked (including service_role writes).
begin;

create table public.generator_documents (
  id uuid primary key,
  series text not null check (series in ('monthly','japan','weekly')),
  period_start date not null,
  period_end date not null check (period_end > period_start),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version integer not null default 1 check (version > 0),
  theme_version integer not null default 1,
  page_versions jsonb not null,
  created_by text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  unique (series, period_start, period_end)
);
create table public.generator_items (
  document_id uuid not null references public.generator_documents(id),
  id uuid not null,
  source jsonb not null,
  content jsonb not null,
  version integer not null default 1 check (version > 0),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (document_id, id)
);
create table public.generator_locks (
  document_id uuid not null references public.generator_documents(id),
  target_kind text not null check (target_kind in ('item','page','theme','structure')),
  target_id uuid not null,
  owner_email text not null,
  client_id uuid not null,
  generation integer not null check (generation > 0),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  primary key (document_id, target_kind, target_id)
);
create table public.generator_revisions (
  document_id uuid not null references public.generator_documents(id),
  version integer not null,
  request_id uuid not null,
  actor text not null,
  operation text not null,
  target_kind text,
  target_id uuid,
  restored_from integer,
  request jsonb not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (document_id, version),
  unique (document_id, request_id)
);
create table public.generator_assets (
  document_id uuid not null references public.generator_documents(id),
  id uuid not null,
  storage_path text not null unique,
  status text not null check (status in ('pending','ready')),
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp')),
  bytes integer not null check (bytes > 0 and bytes <= 10485760),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (document_id, id)
);

alter table public.generator_documents enable row level security;
alter table public.generator_items enable row level security;
alter table public.generator_locks enable row level security;
alter table public.generator_revisions enable row level security;
alter table public.generator_assets enable row level security;
revoke all on public.generator_documents, public.generator_items, public.generator_locks,
  public.generator_revisions, public.generator_assets from public, anon, authenticated, service_role;

-- Internal snapshot helper: no lock tokens/Storage paths/request payload exposed.
create function public.generator_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'document', d.data || jsonb_build_object('items', coalesce((select jsonb_agg(
      jsonb_build_object('id', i.id, 'source', i.source, 'content', i.content) order by i.id)
      from public.generator_items i where i.document_id = d.id), '[]'::jsonb)),
    'version', d.version, 'themeVersion', d.theme_version, 'pageVersions', d.page_versions,
    'itemVersions', coalesce((select jsonb_object_agg(i.id::text, i.version)
      from public.generator_items i where i.document_id = d.id), '{}'::jsonb),
    'updatedAt', d.updated_at, 'updatedBy', d.updated_by)
  from public.generator_documents d where d.id = p_id;
$$;

create function public.generator_check_assets(p_id uuid, p_content jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare ref text;
begin
  for ref in select p_content->>key from unnest(array['jacketAssetId','waveAssetId','backgroundAssetId']) as key loop
    if ref is not null and not exists (select 1 from public.generator_assets
      where document_id = p_id and id = ref::uuid and status = 'ready') then
      raise exception using errcode = 'P0001', message = 'ASSET_NOT_READY';
    end if;
  end loop;
end;
$$;

create function public.generator_create(p_document jsonb, p_actor text, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare doc_id uuid := (p_document->>'id')::uuid; existing public.generator_revisions;
  inserted uuid; slot jsonb; snapshot jsonb;
begin
  if p_actor is null or length(p_actor) = 0 or p_request_id is null
    or p_document->>'schemaVersion' is distinct from '1' then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  insert into public.generator_documents(id, series, period_start, period_end, data, page_versions, created_by, updated_by)
    values (doc_id, p_document->>'series', (p_document->'period'->>'start')::date,
      (p_document->'period'->>'end')::date, p_document - 'items',
      coalesce((select jsonb_object_agg(page->>'id', 1) from jsonb_array_elements(p_document->'pages') as page), '{}'::jsonb), p_actor, p_actor)
    on conflict (id) do nothing returning id into inserted;
  perform 1 from public.generator_documents where id = doc_id for update;
  if inserted is null then
    select * into existing from public.generator_revisions where document_id = doc_id and request_id = p_request_id;
    if found and existing.actor = p_actor and existing.operation = 'create' and existing.request = p_document then
      return existing.snapshot;
    end if;
    raise exception using errcode = 'P0001', message = 'DOCUMENT_EXISTS';
  end if;
  perform public.generator_check_assets(doc_id, p_document->'theme');
  for slot in select * from jsonb_array_elements(p_document->'items') loop
    perform public.generator_check_assets(doc_id, slot->'content');
    insert into public.generator_items(document_id, id, source, content, updated_by)
      values (doc_id, (slot->>'id')::uuid, slot->'source', slot->'content', p_actor);
  end loop;
  snapshot := public.generator_snapshot(doc_id);
  insert into public.generator_revisions(document_id, version, request_id, actor, operation, request, snapshot)
    values (doc_id, 1, p_request_id, p_actor, 'create', p_document, snapshot);
  return snapshot;
end;
$$;

create function public.generator_read(p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_id is null then
    return coalesce((select jsonb_agg(row) from (select id, series, period_start as "periodStart", period_end as "periodEnd",
      version, updated_at as "updatedAt", updated_by as "updatedBy" from public.generator_documents order by updated_at desc limit 100) row), '[]'::jsonb);
  end if;
  result := public.generator_snapshot(p_id);
  if result is null then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  return result || jsonb_build_object('locks', coalesce((select jsonb_agg(jsonb_build_object(
    'kind', target_kind, 'targetId', target_id, 'owner', owner_email, 'expiresAt', expires_at))
    from public.generator_locks where document_id = p_id and expires_at > now()), '[]'::jsonb));
end;
$$;

create function public.generator_lock(p_id uuid, p_actor text, p_action text, p_lock jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare doc public.generator_documents; current_lock public.generator_locks;
  kind text := p_lock->>'kind'; target uuid := (p_lock->>'targetId')::uuid;
  client uuid := (p_lock->>'clientId')::uuid; hash text := p_lock->>'tokenHash';
  generation integer; at_time timestamptz;
begin
  select * into doc from public.generator_documents where id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  at_time := clock_timestamp();
  if p_actor is null or p_actor = '' or client is null or hash is null or hash !~ '^[0-9a-f]{64}$'
    or kind is null or kind not in ('item','page','theme','structure') or target is null
    or p_action is null or p_action not in ('acquire','heartbeat','release','transfer') then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if (kind = 'item' and not exists (select 1 from public.generator_items where document_id = p_id and id = target))
    or (kind = 'page' and not (doc.page_versions ? target::text))
    or (kind in ('theme','structure') and target <> p_id) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  select * into current_lock from public.generator_locks where document_id = p_id and target_kind = kind and target_id = target;
  if p_action in ('acquire','transfer') then
    if exists (select 1 from public.generator_locks where document_id = p_id and expires_at > at_time
      and ((kind = 'structure' and target_kind = 'page') or (kind = 'page' and target_kind = 'structure'))) then
      raise exception using errcode = 'P0001', message = 'LOCK_CONFLICT';
    end if;
    if current_lock.expires_at > at_time then
      -- A retransmission of acquisition is idempotent, not a heartbeat.
      if current_lock.owner_email = p_actor and current_lock.client_id = client and current_lock.token_hash = hash then
        return jsonb_build_object('generation', current_lock.generation, 'expiresAt', current_lock.expires_at, 'owner', p_actor);
      end if;
      if p_action <> 'transfer' or current_lock.owner_email <> p_actor then
        raise exception using errcode = 'P0001', message = 'LOCK_CONFLICT';
      end if;
    end if;
    generation := coalesce(current_lock.generation, 0) + 1;
    insert into public.generator_locks values (p_id, kind, target, p_actor, client, generation, hash, at_time + interval '3 minutes')
      on conflict (document_id, target_kind, target_id) do update set owner_email = excluded.owner_email,
        client_id = excluded.client_id, generation = excluded.generation, token_hash = excluded.token_hash, expires_at = excluded.expires_at;
  else
    if current_lock.expires_at is null or current_lock.expires_at <= at_time
      or current_lock.owner_email is distinct from p_actor or current_lock.client_id is distinct from client
      or current_lock.token_hash is distinct from hash or current_lock.generation is distinct from (p_lock->>'generation')::integer then
      raise exception using errcode = 'P0001', message = 'LOCK_LOST';
    end if;
    generation := current_lock.generation;
    update public.generator_locks set expires_at = case when p_action = 'release' then at_time else at_time + interval '3 minutes' end
      where document_id = p_id and target_kind = kind and target_id = target;
  end if;
  return jsonb_build_object('generation', generation, 'expiresAt', case when p_action = 'release' then at_time else at_time + interval '3 minutes' end, 'owner', p_actor);
end;
$$;

create function public.generator_save(p_id uuid, p_actor text, p_request_id uuid, p_change jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
<<save_operation>>
declare doc public.generator_documents; current_lock public.generator_locks; previous public.generator_revisions;
  kind text := p_change->>'kind'; target uuid := (p_change->>'targetId')::uuid;
  content jsonb := p_change->'content'; current_version integer; snapshot jsonb; page_index integer;
  restore_version integer := (p_change->>'restoreVersion')::integer;
begin
  select * into doc from public.generator_documents where id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if p_actor is null or p_actor = '' or p_request_id is null or kind is null or kind not in ('item','page','theme') or target is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into previous from public.generator_revisions where document_id = p_id and request_id = p_request_id;
  if found then
    if previous.actor = p_actor and previous.request = p_change and previous.operation in ('save','restore') then return previous.snapshot; end if;
    raise exception using errcode = 'P0001', message = 'REQUEST_CONFLICT';
  end if;
  select * into current_lock from public.generator_locks where document_id = p_id and target_kind = kind and target_id = target;
  if current_lock.expires_at is null or current_lock.expires_at <= clock_timestamp()
    or current_lock.owner_email is distinct from p_actor or current_lock.client_id is distinct from (p_change->>'clientId')::uuid
    or current_lock.token_hash is distinct from p_change->>'tokenHash'
    or current_lock.generation is distinct from (p_change->>'generation')::integer then
    raise exception using errcode = 'P0001', message = 'LOCK_LOST';
  end if;
  if kind = 'item' then
    select version into current_version from public.generator_items where document_id = p_id and id = target;
  elsif kind = 'page' then current_version := (doc.page_versions->>target::text)::integer;
  elsif target = p_id then current_version := doc.theme_version;
  end if;
  if current_version is null then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if current_version is distinct from (p_change->>'expectedVersion')::integer then
    raise exception using errcode = 'P0001', message = 'VERSION_CONFLICT';
  end if;
  if restore_version is not null then
    select * into previous from public.generator_revisions where document_id = p_id and version = restore_version;
    if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
    if kind = 'item' then
      select slot->'content' into content from jsonb_array_elements(previous.snapshot->'document'->'items') as slot where slot->>'id' = target::text;
    elsif kind = 'page' then
      select jsonb_build_object('bgColor', page->'bgColor') into content from jsonb_array_elements(previous.snapshot->'document'->'pages') as page where page->>'id' = target::text;
    else content := previous.snapshot->'document'->'theme'; end if;
  end if;
  if content is null or jsonb_typeof(content) <> 'object' then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  perform public.generator_check_assets(p_id, content);
  if kind = 'item' then
    update public.generator_items set content = save_operation.content, version = version + 1, updated_by = p_actor, updated_at = clock_timestamp()
      where document_id = p_id and id = target;
  elsif kind = 'page' then
    select (ordinality - 1)::integer into page_index from jsonb_array_elements(doc.data->'pages') with ordinality where value->>'id' = target::text;
    doc.data := jsonb_set(doc.data, array['pages', page_index::text, 'bgColor'], content->'bgColor');
    doc.page_versions := jsonb_set(doc.page_versions, array[target::text], to_jsonb(current_version + 1));
  else doc.data := jsonb_set(doc.data, '{theme}', content); doc.theme_version := doc.theme_version + 1; end if;
  update public.generator_documents set data = doc.data, page_versions = doc.page_versions, theme_version = doc.theme_version,
    version = version + 1, updated_by = p_actor, updated_at = clock_timestamp() where id = p_id;
  snapshot := public.generator_snapshot(p_id);
  insert into public.generator_revisions(document_id, version, request_id, actor, operation, target_kind, target_id, restored_from, request, snapshot)
    values (p_id, doc.version + 1, p_request_id, p_actor, case when restore_version is null then 'save' else 'restore' end,
      kind, target, restore_version, p_change, snapshot);
  return snapshot;
end;
$$;

create function public.generator_history(p_id uuid, p_before integer default 2147483647) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row), '[]'::jsonb) from (select version, actor, operation, target_kind as "targetKind", target_id as "targetId",
    restored_from as "restoredFrom", created_at as "createdAt" from public.generator_revisions
    where document_id = p_id and version < p_before order by version desc limit 50) row;
$$;

revoke all on function public.generator_snapshot(uuid), public.generator_check_assets(uuid,jsonb), public.generator_create(jsonb,text,uuid),
  public.generator_read(uuid), public.generator_lock(uuid,text,text,jsonb), public.generator_save(uuid,text,uuid,jsonb),
  public.generator_history(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.generator_create(jsonb,text,uuid), public.generator_read(uuid), public.generator_lock(uuid,text,text,jsonb),
  public.generator_save(uuid,text,uuid,jsonb), public.generator_history(uuid,integer) to service_role;
commit;
