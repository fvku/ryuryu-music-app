-- Re-import changes the item set atomically while retaining every surviving item's content/version.
begin;

create function public.generator_reimport(p_id uuid, p_actor text, p_request_id uuid, p_change jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare doc public.generator_documents; current_lock public.generator_locks; previous public.generator_revisions;
  pages jsonb := p_change->'pages'; add_items jsonb := p_change->'addItems'; remove_ids jsonb := p_change->'removeItemIds';
  expected_items jsonb := p_change->'expectedItemVersions'; snapshot jsonb; slot jsonb; merged_pages jsonb;
  current_item_count integer; proposed_item_count integer; proposed_unique_count integer;
begin
  select * into doc from public.generator_documents where id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if p_actor is null or p_actor = '' or p_request_id is null or p_change->>'kind' is distinct from 'structure'
    or (p_change->>'targetId')::uuid is distinct from p_id then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into previous from public.generator_revisions where document_id = p_id and request_id = p_request_id;
  if found then
    if previous.actor = p_actor and previous.request = p_change and previous.operation = 'reimport' then return previous.snapshot; end if;
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
  if jsonb_typeof(pages) <> 'array' or jsonb_typeof(add_items) <> 'array' or jsonb_typeof(remove_ids) <> 'array'
    or jsonb_typeof(expected_items) <> 'object' then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  -- An item save can run alongside a structure lock. Version-check the complete source snapshot so a
  -- re-import never silently overwrites a formatting edit that was saved while the dialog was open.
  if exists (select 1 from public.generator_items i where i.document_id = p_id
    and (not (expected_items ? i.id::text) or expected_items->>i.id::text !~ '^[1-9][0-9]*$'
      or (expected_items->>i.id::text)::integer <> i.version))
    or (select count(*) from jsonb_object_keys(expected_items)) <> (select count(*) from public.generator_items where document_id = p_id) then
    raise exception using errcode = 'P0001', message = 'VERSION_CONFLICT';
  end if;
  -- Do not remove an item/page that another editor still holds. Surviving item edits are protected by
  -- the version test above and may continue independently after this transaction.
  if exists (select 1 from public.generator_locks l where l.document_id = p_id and l.expires_at > clock_timestamp() and (
      (l.target_kind = 'item' and l.target_id::text in (select removed_id.value from jsonb_array_elements_text(remove_ids) removed_id(value)))
      or (l.target_kind = 'page' and not exists (select 1 from jsonb_array_elements(pages) p where (p->>'id') = l.target_id::text))
    )) then raise exception using errcode = 'P0001', message = 'LOCK_CONFLICT'; end if;
  if exists (select 1 from jsonb_array_elements(add_items) entry
      where jsonb_typeof(entry) <> 'object' or not (entry ? 'id') or not (entry ? 'source') or not (entry ? 'content'))
    or exists (select 1 from jsonb_array_elements(add_items) entry where exists (select 1 from public.generator_items i where i.document_id = p_id and i.id::text = entry->>'id'))
    or (select count(distinct entry->>'id') from jsonb_array_elements(add_items) entry) <> jsonb_array_length(add_items)
    or exists (select 1 from jsonb_array_elements_text(remove_ids) removed_id(value)
      where not exists (select 1 from public.generator_items i where i.document_id = p_id and i.id::text = removed_id.value))
    or (select count(distinct removed_id.value) from jsonb_array_elements_text(remove_ids) removed_id(value)) <> jsonb_array_length(remove_ids) then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  for slot in select * from jsonb_array_elements(add_items) loop perform public.generator_check_assets(p_id, slot->'content'); end loop;
  select count(*) into current_item_count from public.generator_items where document_id = p_id;
  select count(*) into proposed_item_count from jsonb_array_elements(pages) p cross join jsonb_array_elements_text(p->'itemIds');
  select count(distinct item_id.value) into proposed_unique_count from jsonb_array_elements(pages) p cross join jsonb_array_elements_text(p->'itemIds') item_id(value);
  if (select count(distinct p->>'id') from jsonb_array_elements(pages) p) <> jsonb_array_length(pages)
    or exists (select 1 from jsonb_array_elements(pages) p where jsonb_typeof(p->'itemIds') <> 'array')
    or proposed_item_count <> current_item_count + jsonb_array_length(add_items) - jsonb_array_length(remove_ids)
    or proposed_unique_count <> proposed_item_count
    or exists (select 1 from jsonb_array_elements(pages) p cross join jsonb_array_elements_text(p->'itemIds') item_id(value)
      where not exists (select 1 from public.generator_items i where i.document_id = p_id and i.id::text = item_id.value
          and item_id.value not in (select value from jsonb_array_elements_text(remove_ids)))
        and not exists (select 1 from jsonb_array_elements(add_items) a where a->>'id' = item_id.value)) then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  -- Existing page colour/metadata wins; only new pages take their supplied values.
  select jsonb_agg(case when current.page is null then proposed.page else current.page || jsonb_build_object('itemIds', proposed.page->'itemIds') end order by proposed.ordinality)
    into merged_pages from jsonb_array_elements(pages) with ordinality proposed(page, ordinality)
    left join jsonb_array_elements(doc.data->'pages') current(page) on (current.page->>'id') = (proposed.page->>'id');
  delete from public.generator_locks where document_id = p_id and target_kind = 'item'
    and target_id::text in (select removed_id.value from jsonb_array_elements_text(remove_ids) removed_id(value));
  delete from public.generator_locks where document_id = p_id and target_kind = 'page'
    and not exists (select 1 from jsonb_array_elements(pages) proposed where (proposed->>'id') = target_id::text);
  delete from public.generator_items where document_id = p_id
    and id::text in (select removed_id.value from jsonb_array_elements_text(remove_ids) removed_id(value));
  for slot in select * from jsonb_array_elements(add_items) loop
    insert into public.generator_items(document_id, id, source, content, updated_by)
      values (p_id, (slot->>'id')::uuid, slot->'source', slot->'content', p_actor);
  end loop;
  doc.data := jsonb_set(doc.data, '{pages}', merged_pages);
  select coalesce(jsonb_object_agg(p->>'id', coalesce((doc.page_versions->>(p->>'id'))::integer, 1)), '{}'::jsonb)
    into doc.page_versions from jsonb_array_elements(merged_pages) p;
  update public.generator_documents set data = doc.data, page_versions = doc.page_versions, structure_version = structure_version + 1,
    version = version + 1, updated_by = p_actor, updated_at = clock_timestamp() where id = p_id;
  snapshot := public.generator_snapshot(p_id);
  insert into public.generator_revisions(document_id, version, request_id, actor, operation, target_kind, target_id, request, snapshot)
    values (p_id, doc.version + 1, p_request_id, p_actor, 'reimport', 'structure', p_id, p_change, snapshot);
  return snapshot;
end;
$$;

revoke all on function public.generator_reimport(uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.generator_reimport(uuid,text,uuid,jsonb) to service_role;

commit;
