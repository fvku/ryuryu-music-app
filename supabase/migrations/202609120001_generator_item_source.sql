-- Adds a versioned RPC for item saves that advance the validated Release Master
-- source snapshot. A distinct function prevents older deployed databases from
-- silently ignoring the new source member while saving content.
begin;

create function public.generator_item_save(p_id uuid, p_actor text, p_request_id uuid, p_change jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
<<save_operation>>
declare doc public.generator_documents; current_lock public.generator_locks; previous public.generator_revisions;
  target uuid := (p_change->>'targetId')::uuid; content jsonb := p_change->'content';
  source_value jsonb := p_change->'source'; stored_source jsonb; current_version integer; snapshot jsonb;
  restore_version integer := (p_change->>'restoreVersion')::integer;
begin
  select * into doc from public.generator_documents where id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if p_actor is null or p_actor = '' or p_request_id is null
    or p_change->>'kind' is distinct from 'item' or target is null
    or (restore_version is null and (content is null or source_value is null))
    or (restore_version is not null and (p_change ? 'content' or p_change ? 'source')) then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into previous from public.generator_revisions where document_id = p_id and request_id = p_request_id;
  if found then
    if previous.actor = p_actor and previous.request = p_change and previous.operation in ('save','restore') then return previous.snapshot; end if;
    raise exception using errcode = 'P0001', message = 'REQUEST_CONFLICT';
  end if;
  select * into current_lock from public.generator_locks where document_id = p_id and target_kind = 'item' and target_id = target;
  if current_lock.expires_at is null or current_lock.expires_at <= clock_timestamp()
    or current_lock.owner_email is distinct from p_actor or current_lock.client_id is distinct from (p_change->>'clientId')::uuid
    or current_lock.token_hash is distinct from p_change->>'tokenHash'
    or current_lock.generation is distinct from (p_change->>'generation')::integer then
    raise exception using errcode = 'P0001', message = 'LOCK_LOST';
  end if;
  select version, source into current_version, stored_source
    from public.generator_items where document_id = p_id and id = target;
  if current_version is null then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if current_version is distinct from (p_change->>'expectedVersion')::integer then
    raise exception using errcode = 'P0001', message = 'VERSION_CONFLICT';
  end if;
  if restore_version is not null then
    select * into previous from public.generator_revisions where document_id = p_id and version = restore_version;
    if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
    select slot->'content', slot->'source' into content, source_value
      from jsonb_array_elements(previous.snapshot->'document'->'items') as slot where slot->>'id' = target::text;
  end if;
  if content is null or jsonb_typeof(content) <> 'object' or source_value is null or jsonb_typeof(source_value) <> 'object'
    or (restore_version is null and (stored_source->>'kind' is distinct from 'release-master'
      or source_value->>'kind' is distinct from 'release-master'))
    or (restore_version is not null and source_value->>'kind' is distinct from stored_source->>'kind')
    or (nullif(btrim(source_value->>'uid'), '') is not null and exists (
      select 1 from public.generator_items i where i.document_id = p_id and i.id <> target
        and nullif(btrim(i.source->>'uid'), '') = nullif(btrim(source_value->>'uid'), '')
    )) then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  perform public.generator_check_assets(p_id, content);
  update public.generator_items set content = save_operation.content, source = source_value,
    version = version + 1, updated_by = p_actor, updated_at = clock_timestamp()
    where document_id = p_id and id = target;
  update public.generator_documents set version = version + 1, updated_by = p_actor,
    updated_at = clock_timestamp() where id = p_id;
  snapshot := public.generator_snapshot(p_id);
  insert into public.generator_revisions(document_id, version, request_id, actor, operation, target_kind, target_id, restored_from, request, snapshot)
    values (p_id, doc.version + 1, p_request_id, p_actor, case when restore_version is null then 'save' else 'restore' end,
      'item', target, restore_version, p_change, snapshot);
  return snapshot;
end;
$$;

revoke all on function public.generator_item_save(uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.generator_item_save(uuid,text,uuid,jsonb) to service_role;

commit;
