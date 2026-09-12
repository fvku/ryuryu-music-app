-- Allows an item save to advance its validated Release Master source snapshot.
-- Existing item content (including jacketAssetId) is only changed by the
-- separately supplied content value in the same targeted save.
begin;

create or replace function public.generator_save(p_id uuid, p_actor text, p_request_id uuid, p_change jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
<<save_operation>>
declare doc public.generator_documents; current_lock public.generator_locks; previous public.generator_revisions;
  kind text := p_change->>'kind'; target uuid := (p_change->>'targetId')::uuid;
  content jsonb := p_change->'content'; source_value jsonb := p_change->'source'; stored_source jsonb;
  current_version integer; snapshot jsonb; page_index integer;
  restore_version integer := (p_change->>'restoreVersion')::integer;
begin
  select * into doc from public.generator_documents where id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if p_actor is null or p_actor = '' or p_request_id is null or kind is null or kind not in ('item','page','theme') or target is null
    or (kind <> 'item' and p_change ? 'source')
    or (restore_version is not null and (p_change ? 'content' or p_change ? 'source')) then
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
    select version, source into current_version, stored_source from public.generator_items where document_id = p_id and id = target;
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
      select slot->'content', slot->'source' into content, source_value
        from jsonb_array_elements(previous.snapshot->'document'->'items') as slot where slot->>'id' = target::text;
    elsif kind = 'page' then
      select jsonb_build_object('bgColor', page->'bgColor') into content
        from jsonb_array_elements(previous.snapshot->'document'->'pages') as page where page->>'id' = target::text;
    else content := previous.snapshot->'document'->'theme'; end if;
  end if;
  if content is null or jsonb_typeof(content) <> 'object' then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  if kind = 'item' and source_value is not null then
    if jsonb_typeof(source_value) <> 'object'
      or (restore_version is null and (stored_source->>'kind' is distinct from 'release-master'
        or source_value->>'kind' is distinct from 'release-master'))
      or (restore_version is not null and source_value->>'kind' is distinct from stored_source->>'kind')
      or (nullif(btrim(source_value->>'uid'), '') is not null and exists (
        select 1 from public.generator_items i where i.document_id = p_id and i.id <> target
          and nullif(btrim(i.source->>'uid'), '') = nullif(btrim(source_value->>'uid'), '')
      )) then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  end if;
  perform public.generator_check_assets(p_id, content);
  if kind = 'item' then
    update public.generator_items set content = save_operation.content,
      source = coalesce(source_value, source), version = version + 1,
      updated_by = p_actor, updated_at = clock_timestamp()
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

revoke all on function public.generator_save(uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.generator_save(uuid,text,uuid,jsonb) to service_role;

commit;
