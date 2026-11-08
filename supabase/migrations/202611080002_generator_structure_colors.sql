-- 並び順の保存で、背景色を作品に追従させる（2026-11-08）。
-- 色の保存先はページのまま。ページのIDと並びは変えず、作品が動いた分だけ bgColor を移す。
-- 規則は lib/generator/page-colors.ts の bgColorFollowingItems と同じ：同じ区分の前のページだけを見て、
-- 先頭の作品から順に、色が設定されている最初のページの色を使う。表紙とOthersはページの色のまま。
-- 色が変わったページは page_versions を進める（古い版を見ている人の背景色保存を競合として止めるため）。
begin;

create or replace function public.generator_structure_save(p_id uuid, p_actor text, p_request_id uuid, p_change jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare doc public.generator_documents; current_lock public.generator_locks; previous public.generator_revisions;
  content jsonb := p_change->'content'; pages jsonb; snapshot jsonb; restore_version integer := (p_change->>'restoreVersion')::integer;
  page_count integer; item_count integer; merged_pages jsonb;
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
  select jsonb_agg(
      case when current->>'kind' in ('adopted', 'listed', 'feature')
        then current || jsonb_build_object('itemIds', proposed->'itemIds', 'bgColor', coalesce((
          select origin.page->'bgColor'
            from jsonb_array_elements_text(proposed->'itemIds') with ordinality as moved(item_id, position)
            join jsonb_array_elements(doc.data->'pages') as origin(page)
              on origin.page->>'kind' = current->>'kind' and (origin.page->'itemIds') ? moved.item_id
            where jsonb_typeof(origin.page->'bgColor') = 'string'
            order by moved.position limit 1), 'null'::jsonb))
        else current || jsonb_build_object('itemIds', proposed->'itemIds')
      end order by ordinality) into merged_pages
    from jsonb_array_elements(doc.data->'pages') with ordinality as source(current, ordinality)
    join jsonb_array_elements(pages) proposed on proposed->>'id' = current->>'id';
  select jsonb_object_agg(old_page.page->>'id', coalesce((doc.page_versions->>(old_page.page->>'id'))::integer, 1)
      + case when old_page.page->'bgColor' is distinct from new_page.page->'bgColor' then 1 else 0 end) into doc.page_versions
    from jsonb_array_elements(doc.data->'pages') old_page(page)
    join jsonb_array_elements(merged_pages) new_page(page) on new_page.page->>'id' = old_page.page->>'id';
  doc.data := jsonb_set(doc.data, '{pages}', merged_pages);
  update public.generator_documents set data = doc.data, page_versions = doc.page_versions, structure_version = structure_version + 1,
    version = version + 1, updated_by = p_actor, updated_at = clock_timestamp() where id = p_id;
  snapshot := public.generator_snapshot(p_id);
  insert into public.generator_revisions(document_id, version, request_id, actor, operation, target_kind, target_id, restored_from, request, snapshot)
    values (p_id, doc.version + 1, p_request_id, p_actor, case when restore_version is null then 'save' else 'restore' end,
      'structure', p_id, restore_version, p_change, snapshot);
  return snapshot;
end;
$$;

commit;
