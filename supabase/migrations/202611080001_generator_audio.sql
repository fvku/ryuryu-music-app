-- 動画に付ける音楽の共有（2026-11-08）。
-- - 音声ファイルの実体は Backblaze B2 の非公開バケットに置き、この表は場所・状態・検査値だけを持つ。
-- - 曲・範囲・フェードは作品の content.music（content は丸ごと保存なので関数の変更は不要）。
-- - 掲載ページの「上下どちらの曲」はページの musicItemId。ページの保存・復元（generator_save）を差し替える。
-- 既存の方針どおり、表は RLS 有効・直接権限なし、RPC は SECURITY DEFINER・空の search_path で service_role だけが実行できる。
begin;

create table public.generator_audio (
  document_id uuid not null references public.generator_documents(id),
  id uuid not null,
  -- 作品は取り込み直しで削除されることがあるので外部キーにしない（削除済みの作品の音声は期限で消える）。
  item_id uuid not null,
  object_key text not null unique,
  status text not null check (status in ('pending','ready','deleted')),
  mime_type text not null check (mime_type in ('audio/mpeg','audio/mp4')),
  bytes integer not null check (bytes > 0 and bytes <= 52428800),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  name text not null check (length(name) between 1 and 200),
  created_by text not null,
  created_at timestamptz not null default now(),
  -- 対象月の終わり（period_end＝翌月1日の0時、日本時間）から1年後に B2 から消す。
  expires_at timestamptz not null,
  deleted_at timestamptz,
  primary key (document_id, id)
);
alter table public.generator_audio enable row level security;
revoke all on public.generator_audio from public, anon, authenticated, service_role;

-- 画像に加えて、作品の music.audioId も確かめる。
-- 期限で削除済み（deleted）の音声も通す。1年たった文書で文字だけ直して保存したときに止めないため。
create or replace function public.generator_check_assets(p_id uuid, p_content jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare ref text; audio text;
begin
  for ref in select p_content->>key from unnest(array['jacketAssetId','waveAssetId','backgroundAssetId']) as key loop
    if ref is not null and not exists (select 1 from public.generator_assets
      where document_id = p_id and id = ref::uuid and status = 'ready') then
      raise exception using errcode = 'P0001', message = 'ASSET_NOT_READY';
    end if;
  end loop;
  if jsonb_typeof(p_content->'music') = 'object' then
    audio := p_content->'music'->>'audioId';
    if audio is not null and not exists (select 1 from public.generator_audio
      where document_id = p_id and id = audio::uuid and status in ('ready','deleted')) then
      raise exception using errcode = 'P0001', message = 'ASSET_NOT_READY';
    end if;
  end if;
end;
$$;

-- 202609040001 の generator_save を差し替える。変えたのはページ（kind = 'page'）の保存と復元だけ。
-- ページの content は {bgColor, musicItemId?}。musicItemId を省略した保存（移行前のクライアント）は保存済みの値を残す。
-- null はキーごと消す（未設定は「先頭の作品」）。保存ではページにある作品だけを受け付け、
-- 復元では並び順の変更でページから外れた作品なら未設定に戻す（過去版の復元を止めないため）。
create or replace function public.generator_save(p_id uuid, p_actor text, p_request_id uuid, p_change jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
<<save_operation>>
declare doc public.generator_documents; current_lock public.generator_locks; previous public.generator_revisions;
  kind text := p_change->>'kind'; target uuid := (p_change->>'targetId')::uuid;
  content jsonb := p_change->'content'; current_version integer; snapshot jsonb; page_index integer;
  restore_version integer := (p_change->>'restoreVersion')::integer; music_item text;
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
      select jsonb_build_object('bgColor', page->'bgColor', 'musicItemId', coalesce(page->'musicItemId', 'null'::jsonb)) into content
        from jsonb_array_elements(previous.snapshot->'document'->'pages') as page where page->>'id' = target::text;
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
    if content ? 'musicItemId' then
      music_item := case when jsonb_typeof(content->'musicItemId') = 'string' then content->>'musicItemId' else null end;
      if jsonb_typeof(content->'musicItemId') not in ('string','null') then
        raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
      end if;
      if music_item is not null and not ((doc.data->'pages'->page_index->'itemIds') ? music_item) then
        if restore_version is null then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
        music_item := null;
      end if;
      if music_item is null then
        doc.data := doc.data #- array['pages', page_index::text, 'musicItemId'];
      else
        doc.data := jsonb_set(doc.data, array['pages', page_index::text, 'musicItemId'], to_jsonb(music_item));
      end if;
    end if;
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

-- アップロードの準備。作品のロックが必要（ジャケット画像と同じ）。B2 の置き場所はここで決める。
create function public.generator_audio_prepare(p_id uuid, p_actor text, p_audio jsonb, p_lock jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare doc public.generator_documents; current_lock public.generator_locks; existing public.generator_audio;
  audio_id uuid := (p_audio->>'id')::uuid; item uuid := (p_audio->>'itemId')::uuid; mime text := p_audio->>'mimeType';
  size integer := (p_audio->>'bytes')::integer; hash text := p_audio->>'sha256'; file_name text := p_audio->>'name';
  extension text; key text;
begin
  select * into doc from public.generator_documents where id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if p_actor is null or p_actor = '' or doc.series = 'weekly' or p_lock->>'kind' is distinct from 'item'
    or item is null or (p_lock->>'targetId')::uuid is distinct from item
    or not exists (select 1 from public.generator_items where document_id = p_id and id = item) then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  select * into current_lock from public.generator_locks where document_id = p_id and target_kind = 'item' and target_id = item;
  if current_lock.expires_at is null or current_lock.expires_at <= clock_timestamp()
    or current_lock.owner_email is distinct from p_actor or current_lock.client_id is distinct from (p_lock->>'clientId')::uuid
    or current_lock.token_hash is distinct from p_lock->>'tokenHash'
    or current_lock.generation is distinct from (p_lock->>'generation')::integer then
    raise exception using errcode = 'P0001', message = 'LOCK_LOST';
  end if;
  extension := case mime when 'audio/mpeg' then 'mp3' when 'audio/mp4' then 'm4a' else null end;
  if audio_id is null or extension is null or size is null or size not between 1 and 52428800
    or hash is null or hash !~ '^[0-9a-f]{64}$' or file_name is null or length(file_name) not between 1 and 200 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  key := 'audio/' || p_id::text || '/' || audio_id::text || '.' || extension;
  select * into existing from public.generator_audio where document_id = p_id and id = audio_id;
  if found then
    -- 同じ内容の再送は冪等。
    if existing.created_by = p_actor and existing.item_id = item and existing.object_key = key and existing.mime_type = mime
      and existing.bytes = size and existing.sha256 = hash and existing.name = file_name and existing.status <> 'deleted' then
      return jsonb_build_object('id', audio_id, 'objectKey', key, 'status', existing.status);
    end if;
    raise exception using errcode = 'P0001', message = 'REQUEST_CONFLICT';
  end if;
  insert into public.generator_audio(document_id, id, item_id, object_key, status, mime_type, bytes, sha256, name, created_by, expires_at)
    values (p_id, audio_id, item, key, 'pending', mime, size, hash, file_name, p_actor,
      ((doc.period_end + interval '1 year')::timestamp) at time zone 'Asia/Tokyo');
  return jsonb_build_object('id', audio_id, 'objectKey', key, 'status', 'pending');
end;
$$;

-- アップロードの確定。サーバーが B2 上のサイズ・SHA-256 を確かめた後に呼ぶ。準備と同じ人・同じ作品のロックが必要。
create function public.generator_audio_ready(p_id uuid, p_actor text, p_audio_id uuid, p_sha256 text, p_lock jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare audio public.generator_audio; current_lock public.generator_locks;
begin
  select * into audio from public.generator_audio where document_id = p_id and id = p_audio_id for update;
  if not found or audio.status = 'deleted' then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if audio.created_by is distinct from p_actor or audio.sha256 is distinct from p_sha256
    or p_lock->>'kind' is distinct from 'item' or (p_lock->>'targetId')::uuid is distinct from audio.item_id then
    raise exception using errcode = 'P0001', message = 'LOCK_LOST';
  end if;
  select * into current_lock from public.generator_locks where document_id = p_id and target_kind = 'item' and target_id = audio.item_id;
  if current_lock.expires_at is null or current_lock.expires_at <= clock_timestamp()
    or current_lock.owner_email is distinct from p_actor or current_lock.client_id is distinct from (p_lock->>'clientId')::uuid
    or current_lock.token_hash is distinct from p_lock->>'tokenHash'
    or current_lock.generation is distinct from (p_lock->>'generation')::integer then
    raise exception using errcode = 'P0001', message = 'LOCK_LOST';
  end if;
  update public.generator_audio set status = 'ready' where document_id = p_id and id = p_audio_id;
  return jsonb_build_object('id', audio.id, 'itemId', audio.item_id, 'name', audio.name, 'mimeType', audio.mime_type, 'bytes', audio.bytes);
end;
$$;

-- 音声1件の情報（状態を問わない）。読み出しの認可はサーバーが ready のときだけ署名付きURLを出すことで行う。
create function public.generator_audio_read(p_id uuid, p_audio_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare audio public.generator_audio;
begin
  select * into audio from public.generator_audio where document_id = p_id and id = p_audio_id;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  return jsonb_build_object('id', audio.id, 'itemId', audio.item_id, 'objectKey', audio.object_key, 'status', audio.status,
    'mimeType', audio.mime_type, 'bytes', audio.bytes, 'sha256', audio.sha256, 'name', audio.name,
    'createdBy', audio.created_by, 'expiresAt', audio.expires_at);
end;
$$;

-- 自動削除の対象：保存期間を過ぎた ready と、1日たっても確定しなかった pending。
create function public.generator_audio_expired(p_limit integer default 100) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row), '[]'::jsonb) from (
    select document_id as "documentId", id, object_key as "objectKey", status from public.generator_audio
    where (status = 'ready' and expires_at <= now()) or (status = 'pending' and created_at <= now() - interval '1 day')
    order by created_at limit greatest(1, least(coalesce(p_limit, 100), 500))) row;
$$;

-- B2 から消した後に呼ぶ。ready は削除済みとして記録を残し（作品の content から参照され得るため）、pending は行ごと消す。
create function public.generator_audio_forget(p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare changed integer := 0; counted integer;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception using errcode = 'P0001', message = 'INVALID_INPUT'; end if;
  update public.generator_audio a set status = 'deleted', deleted_at = clock_timestamp()
    from jsonb_array_elements(p_items) entry
    where a.document_id = (entry->>'documentId')::uuid and a.id = (entry->>'id')::uuid and a.status = 'ready' and a.expires_at <= now();
  get diagnostics counted = row_count; changed := changed + counted;
  delete from public.generator_audio a using jsonb_array_elements(p_items) entry
    where a.document_id = (entry->>'documentId')::uuid and a.id = (entry->>'id')::uuid
      and a.status = 'pending' and a.created_at <= now() - interval '1 day';
  get diagnostics counted = row_count; changed := changed + counted;
  return changed;
end;
$$;

revoke all on function public.generator_audio_prepare(uuid,text,jsonb,jsonb), public.generator_audio_ready(uuid,text,uuid,text,jsonb),
  public.generator_audio_read(uuid,uuid), public.generator_audio_expired(integer), public.generator_audio_forget(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.generator_audio_prepare(uuid,text,jsonb,jsonb), public.generator_audio_ready(uuid,text,uuid,text,jsonb),
  public.generator_audio_read(uuid,uuid), public.generator_audio_expired(integer), public.generator_audio_forget(jsonb) to service_role;

commit;
