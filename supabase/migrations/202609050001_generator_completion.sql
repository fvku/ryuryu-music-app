-- Adds structure saves and the private asset upload lifecycle without touching pl_* objects.
begin;

alter table public.generator_documents add column structure_version integer not null default 1 check (structure_version > 0);

create or replace function public.generator_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'document', d.data || jsonb_build_object('items', coalesce((select jsonb_agg(
      jsonb_build_object('id', i.id, 'source', i.source, 'content', i.content) order by i.id)
      from public.generator_items i where i.document_id = d.id), '[]'::jsonb)),
    'version', d.version, 'themeVersion', d.theme_version, 'structureVersion', d.structure_version,
    'pageVersions', d.page_versions,
    'itemVersions', coalesce((select jsonb_object_agg(i.id::text, i.version)
      from public.generator_items i where i.document_id = d.id), '{}'::jsonb),
    'updatedAt', d.updated_at, 'updatedBy', d.updated_by)
  from public.generator_documents d where d.id = p_id;
$$;

create function public.generator_structure_save(p_id uuid, p_actor text, p_request_id uuid, p_change jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare doc public.generator_documents; current_lock public.generator_locks; previous public.generator_revisions;
  content jsonb := p_change->'content'; pages jsonb; snapshot jsonb; restore_version integer := (p_change->>'restoreVersion')::integer;
  page_count integer; item_count integer;
begin
  select * into doc from public.generator_documents where id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if p_actor is null or p_actor = '' or p_request_id is null or p_change->>'kind' is distinct from 'structure'
    or (p_change->>'targetId')::uuid is distinct from p_id then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into previous from public.generator_revisions where document_id = p_id and request_id = p_request_id;
  if found then
    if previous.actor = p_actor and previous.request = p_change and previous.operation in ('save','restore') then return previous.snapshot; end if;
    raise exception using errcode = 'P0001', message = 'REQUEST_CONFLICT';
  end if;
  select * into current_lock from public.generator_locks where document_id = p_id and target_kind = 'structure' and target_id = p_id;
  if current_lock.expires_at is null or current_lock.expires_at <= clock_timestamp()
    or current_lock.owner_email is distinct from p_actor or current_lock.client_id is distinct from (p_change->>'clientId')::uuid
    or current_lock.token_hash is distinct from p_change->>'tokenHash'
    or current_lock.generation is distinct from (p_change->>'generation')::integer then
    raise exception using errcode = 'P0001', message = 'LOCK_LOST';
  end if;
  if doc.structure_version is distinct from (p_change->>'expectedVersion')::integer then
    raise exception using errcode = 'P0001', message = 'VERSION_CONFLICT';
  end if;
  if restore_version is not null then
    select * into previous from public.generator_revisions where document_id = p_id and version = restore_version;
    if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
    select jsonb_build_object('pages', jsonb_agg(jsonb_build_object('id', page->'id', 'itemIds', page->'itemIds') order by ordinality))
      into content from jsonb_array_elements(previous.snapshot->'document'->'pages') with ordinality as source(page, ordinality);
  end if;
  pages := content->'pages';
  if content is null or jsonb_typeof(content) <> 'object' or jsonb_typeof(pages) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select count(*) into page_count from jsonb_array_elements(doc.data->'pages');
  select count(*) into item_count from public.generator_items where document_id = p_id;
  if jsonb_array_length(pages) <> page_count
    or (select count(distinct value->>'id') from jsonb_array_elements(pages)) <> page_count
    or exists (select 1 from jsonb_array_elements(pages) proposed
      where not exists (select 1 from jsonb_array_elements(doc.data->'pages') current where current->>'id' = proposed->>'id')
        or jsonb_typeof(proposed->'itemIds') <> 'array'
        or jsonb_array_length(proposed->'itemIds') <> (select jsonb_array_length(current->'itemIds') from jsonb_array_elements(doc.data->'pages') current where current->>'id' = proposed->>'id'))
    or (select count(*) from jsonb_array_elements(pages) page cross join jsonb_array_elements_text(page->'itemIds')) <> item_count
    or (select count(distinct item.value) from jsonb_array_elements(pages) page cross join jsonb_array_elements_text(page->'itemIds') item(value)) <> item_count
    or exists (select 1 from jsonb_array_elements(pages) page cross join jsonb_array_elements_text(page->'itemIds') item
      where not exists (select 1 from public.generator_items stored where stored.document_id = p_id and stored.id::text = item.value)) then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select jsonb_agg(current || jsonb_build_object('itemIds', proposed->'itemIds') order by ordinality) into pages
    from jsonb_array_elements(doc.data->'pages') with ordinality as source(current, ordinality)
    join jsonb_array_elements(pages) proposed on proposed->>'id' = current->>'id';
  doc.data := jsonb_set(doc.data, '{pages}', pages);
  update public.generator_documents set data = doc.data, structure_version = structure_version + 1,
    version = version + 1, updated_by = p_actor, updated_at = clock_timestamp() where id = p_id;
  snapshot := public.generator_snapshot(p_id);
  insert into public.generator_revisions(document_id, version, request_id, actor, operation, target_kind, target_id, restored_from, request, snapshot)
    values (p_id, doc.version + 1, p_request_id, p_actor, case when restore_version is null then 'save' else 'restore' end,
      'structure', p_id, restore_version, p_change, snapshot);
  return snapshot;
end;
$$;

create function public.generator_asset_prepare(p_id uuid, p_actor text, p_asset jsonb, p_lock jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare doc public.generator_documents; current_lock public.generator_locks; existing public.generator_assets;
  asset_id uuid := (p_asset->>'id')::uuid; kind text := p_lock->>'kind'; target uuid := (p_lock->>'targetId')::uuid;
  mime text := p_asset->>'mimeType'; extension text; storage_path text;
begin
  select * into doc from public.generator_documents where id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if kind not in ('item','theme') or (kind = 'theme' and target <> p_id)
    or (kind = 'item' and not exists (select 1 from public.generator_items where document_id = p_id and id = target)) then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into current_lock from public.generator_locks where document_id = p_id and target_kind = kind and target_id = target;
  if current_lock.expires_at is null or current_lock.expires_at <= clock_timestamp()
    or current_lock.owner_email is distinct from p_actor or current_lock.client_id is distinct from (p_lock->>'clientId')::uuid
    or current_lock.token_hash is distinct from p_lock->>'tokenHash'
    or current_lock.generation is distinct from (p_lock->>'generation')::integer then
    raise exception using errcode = 'P0001', message = 'LOCK_LOST';
  end if;
  extension := case mime when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' else null end;
  if asset_id is null or extension is null or (p_asset->>'bytes')::integer not between 1 and 10485760
    or (p_asset->>'width')::integer not between 1 and 12000 or (p_asset->>'height')::integer not between 1 and 12000
    or (p_asset->>'sha256') !~ '^[0-9a-f]{64}$' then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  storage_path := p_id::text || '/' || asset_id::text || '.' || extension;
  select * into existing from public.generator_assets where document_id = p_id and id = asset_id;
  if found then
    if existing.created_by = p_actor and existing.storage_path = storage_path and existing.mime_type = mime
      and existing.bytes = (p_asset->>'bytes')::integer and existing.width = (p_asset->>'width')::integer
      and existing.height = (p_asset->>'height')::integer and existing.sha256 = p_asset->>'sha256' then
      return jsonb_build_object('id', asset_id, 'path', storage_path, 'status', existing.status);
    end if;
    raise exception using errcode = 'P0001', message = 'REQUEST_CONFLICT';
  end if;
  insert into public.generator_assets(document_id,id,storage_path,status,mime_type,bytes,width,height,sha256,created_by)
    values (p_id,asset_id,storage_path,'pending',mime,(p_asset->>'bytes')::integer,(p_asset->>'width')::integer,(p_asset->>'height')::integer,p_asset->>'sha256',p_actor);
  return jsonb_build_object('id', asset_id, 'path', storage_path, 'status', 'pending');
end;
$$;

create function public.generator_asset_ready(p_id uuid, p_actor text, p_asset_id uuid, p_sha256 text, p_lock jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare asset public.generator_assets; current_lock public.generator_locks;
begin
  select * into asset from public.generator_assets where document_id = p_id and id = p_asset_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if asset.created_by is distinct from p_actor or asset.sha256 is distinct from p_sha256 then
    raise exception using errcode = 'P0001', message = 'LOCK_LOST';
  end if;
  select * into current_lock from public.generator_locks where document_id = p_id and target_kind = p_lock->>'kind' and target_id = (p_lock->>'targetId')::uuid;
  if current_lock.expires_at is null or current_lock.expires_at <= clock_timestamp()
    or current_lock.owner_email is distinct from p_actor or current_lock.client_id is distinct from (p_lock->>'clientId')::uuid
    or current_lock.token_hash is distinct from p_lock->>'tokenHash'
    or current_lock.generation is distinct from (p_lock->>'generation')::integer then
    raise exception using errcode = 'P0001', message = 'LOCK_LOST';
  end if;
  update public.generator_assets set status = 'ready' where document_id = p_id and id = p_asset_id;
  return jsonb_build_object('id',asset.id,'mimeType',asset.mime_type,'bytes',asset.bytes,'width',asset.width,'height',asset.height);
end;
$$;

create function public.generator_asset_read(p_id uuid, p_asset_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare asset public.generator_assets;
begin
  select * into asset from public.generator_assets where document_id = p_id and id = p_asset_id and status = 'ready';
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  return jsonb_build_object('id',asset.id,'path',asset.storage_path,'mimeType',asset.mime_type,'bytes',asset.bytes,'width',asset.width,'height',asset.height);
end;
$$;

revoke all on function public.generator_structure_save(uuid,text,uuid,jsonb), public.generator_asset_prepare(uuid,text,jsonb,jsonb),
  public.generator_asset_ready(uuid,text,uuid,text,jsonb), public.generator_asset_read(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.generator_structure_save(uuid,text,uuid,jsonb), public.generator_asset_prepare(uuid,text,jsonb,jsonb),
  public.generator_asset_ready(uuid,text,uuid,text,jsonb), public.generator_asset_read(uuid,uuid) to service_role;

commit;
