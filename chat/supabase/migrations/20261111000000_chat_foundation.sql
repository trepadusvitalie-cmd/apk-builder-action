-- =====================================================================
-- Fundația bazei de date pentru chat (mesagerie + apeluri)
-- Fiecare decizie de mai jos e legată de o lecție din docs/LECTII.md (L1..L14).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipuri
-- ---------------------------------------------------------------------
create type public.conversation_kind  as enum ('direct', 'group');
create type public.member_role        as enum ('owner', 'admin', 'member');
create type public.message_kind       as enum ('text', 'media', 'system', 'call');
-- L1/L2: nu pretindem criptare pe care nu o avem. Fiecare mesaj spune explicit
-- cum e protejat, iar clientul afișează asta utilizatorului.
create type public.message_encryption as enum ('none', 'e2ee_v1');
create type public.call_kind          as enum ('audio', 'video');

-- ---------------------------------------------------------------------
-- Profiluri — L3: identitate prin username, fără număr de telefon,
-- fără încărcarea agendei.
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,32}$'),
  display_name text not null check (char_length(display_name) between 1 and 64),
  avatar_path  text,
  created_at   timestamptz not null default now()
);

-- L3: blocare la nivel de server, nu doar ascundere în client.
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------------
-- Dispozitive — L5: multi-device gândit de la început; L1: locul cheilor
-- publice pentru viitoarea criptare end-to-end.
-- ---------------------------------------------------------------------
create table public.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 64),
  identity_key text,                 -- cheie publică (base64); null până la faza E2EE
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index devices_user_idx on public.devices (user_id);

-- Token-urile push sunt separate de chei: doar proprietarul și serverul le văd.
create table public.push_tokens (
  device_id  uuid primary key references public.devices (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  provider   text not null check (provider in ('fcm', 'apns', 'unifiedpush')),
  token      text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Conversații
-- ---------------------------------------------------------------------
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  kind            public.conversation_kind not null,
  title           text check (char_length(title) between 1 and 100),
  -- "uuid_mic:uuid_mare" — garantează o singură conversație directă per pereche.
  direct_key      text unique,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check ((kind = 'direct') = (direct_key is not null)),
  check (kind = 'direct' or title is not null)
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            public.member_role not null default 'member',
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

-- ---------------------------------------------------------------------
-- Mesaje — L6: ordinea și timpul le decide serverul; client_id face
-- retrimiterea idempotentă (fără dubluri la rețea slabă).
-- ---------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid default auth.uid() references public.profiles (id) on delete set null,
  client_id       uuid not null default gen_random_uuid(),
  kind            public.message_kind not null default 'text',
  encryption      public.message_encryption not null default 'none',
  -- text simplu când encryption = 'none'; ciphertext base64 când e 'e2ee_v1'
  body            text check (char_length(body) <= 8000),
  reply_to        uuid references public.messages (id) on delete set null,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  unique (sender_id, client_id)
);
create index messages_conversation_idx on public.messages (conversation_id, created_at desc);
create index messages_sender_idx on public.messages (sender_id, created_at desc);

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages (id) on delete cascade,
  -- cale în bucket-ul privat "attachments": <conversation_id>/<fișier>
  storage_path text not null,
  mime_type    text not null,
  size_bytes   bigint not null check (size_bytes > 0),
  created_at   timestamptz not null default now()
);
create index attachments_message_idx on public.attachments (message_id);

-- ---------------------------------------------------------------------
-- Apeluri — L7/L8: camere cu nume aleatoriu (nu ID numeric ghicibil),
-- intrare doar cu token emis de server pentru membrii conversației,
-- posibilitate de blocare a camerei.
-- ---------------------------------------------------------------------
create table public.calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  started_by      uuid references public.profiles (id) on delete set null,
  kind            public.call_kind not null default 'video',
  room_name       text not null unique default ('call_' || replace(gen_random_uuid()::text, '-', '')),
  locked          boolean not null default false,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz
);
-- Un singur apel activ per conversație.
create unique index calls_one_active_idx on public.calls (conversation_id) where ended_at is null;

create table public.call_participants (
  call_id   uuid not null references public.calls (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at   timestamptz,
  primary key (call_id, user_id)
);

-- =====================================================================
-- Funcții ajutătoare pentru RLS (security definer ca să evităm recursia)
-- =====================================================================
create function public.is_member(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id and m.user_id = (select auth.uid())
  );
$$;

create function public.shares_conversation(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.conversation_members mine
    join public.conversation_members theirs using (conversation_id)
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;

create function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

-- Poate utilizatorul curent să scrie în conversație?
create function public.can_send(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_member(p_conversation_id)
     and not exists (
       select 1
       from public.conversations c
       join public.conversation_members other on other.conversation_id = c.id
       where c.id = p_conversation_id
         and c.kind = 'direct'
         and other.user_id <> (select auth.uid())
         and public.is_blocked_between((select auth.uid()), other.user_id)
     );
$$;

-- =====================================================================
-- Triggere
-- =====================================================================

-- Profil creat automat la înregistrare.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_fallback text := 'user_' || substr(replace(new.id::text, '-', ''), 6, 27);
  v_display  text := nullif(trim(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 64)), '');
begin
  if v_username !~ '^[a-z0-9_]{3,32}$'
     or exists (select 1 from public.profiles p where p.username = v_username) then
    v_username := v_fallback;
  end if;
  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, coalesce(v_display, v_username));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- L6: timpul vine de la server. L3: frână simplă anti-spam.
create function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_recent int;
begin
  new.created_at := now();
  new.edited_at  := null;
  new.deleted_at := null;
  if new.sender_id is not null then
    select count(*) into v_recent
    from public.messages m
    where m.sender_id = new.sender_id and m.created_at > now() - interval '10 seconds';
    if v_recent >= 30 then
      raise exception 'rate_limited' using errcode = 'P0001',
        hint = 'Prea multe mesaje într-un timp scurt.';
    end if;
  end if;
  return new;
end;
$$;

create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.messages_before_insert();

create function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations set last_message_at = new.created_at
  where id = new.conversation_id;
  return null;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.messages_after_insert();

-- =====================================================================
-- API (RPC) — toate modificările de structură trec prin funcții verificate
-- =====================================================================

-- L3: căutare doar după username exact; nu există listare/enumerare de utilizatori.
create function public.find_user(p_username text)
returns table (id uuid, username text, display_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.display_name
  from public.profiles p
  where (select auth.uid()) is not null
    and p.username = lower(trim(p_username))
    and not public.is_blocked_between((select auth.uid()), p.id);
$$;

create function public.create_direct_conversation(p_other_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := auth.uid();
  v_key text;
  v_id  uuid;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if p_other_user = v_me then raise exception 'cannot_chat_with_self'; end if;
  if not exists (select 1 from public.profiles where id = p_other_user) then
    raise exception 'user_not_found';
  end if;
  if public.is_blocked_between(v_me, p_other_user) then
    raise exception 'user_not_found';  -- nu dezvăluim existența blocării
  end if;

  v_key := least(v_me::text, p_other_user::text) || ':' || greatest(v_me::text, p_other_user::text);

  insert into public.conversations (kind, direct_key, created_by)
  values ('direct', v_key, v_me)
  on conflict (direct_key) do nothing
  returning id into v_id;

  if v_id is null then
    select c.id into v_id from public.conversations c where c.direct_key = v_key;
  else
    insert into public.conversation_members (conversation_id, user_id, role)
    values (v_id, v_me, 'member'), (v_id, p_other_user, 'member');
  end if;
  return v_id;
end;
$$;

-- L3/L9: nimeni nu poate fi băgat într-un grup de un necunoscut — poți adăuga
-- doar persoane cu care ai deja o conversație directă.
create function public.can_add_to_group(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.conversations c
    where c.kind = 'direct'
      and c.direct_key = least((select auth.uid())::text, p_user::text) || ':'
                      || greatest((select auth.uid())::text, p_user::text)
  ) and not public.is_blocked_between((select auth.uid()), p_user);
$$;

create function public.create_group(p_title text, p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_member uuid;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if coalesce(array_length(p_member_ids, 1), 0) > 255 then raise exception 'group_too_large'; end if;

  insert into public.conversations (kind, title, created_by)
  values ('group', trim(p_title), v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_id, v_me, 'owner');

  foreach v_member in array coalesce(p_member_ids, '{}'::uuid[]) loop
    if v_member = v_me then continue; end if;
    if not public.can_add_to_group(v_member) then
      raise exception 'cannot_add_member' using hint = v_member::text;
    end if;
    insert into public.conversation_members (conversation_id, user_id)
    values (v_id, v_member) on conflict do nothing;
  end loop;
  return v_id;
end;
$$;

create function public.add_member(p_conversation_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
begin
  if not exists (
    select 1 from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    where m.conversation_id = p_conversation_id and m.user_id = v_me
      and m.role in ('owner', 'admin') and c.kind = 'group'
  ) then
    raise exception 'forbidden';
  end if;
  if not public.can_add_to_group(p_user) then raise exception 'cannot_add_member'; end if;
  if (select count(*) from public.conversation_members where conversation_id = p_conversation_id) >= 256 then
    raise exception 'group_too_large';
  end if;
  insert into public.conversation_members (conversation_id, user_id)
  values (p_conversation_id, p_user) on conflict do nothing;
end;
$$;

create function public.leave_conversation(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
begin
  if not exists (select 1 from public.conversations where id = p_conversation_id and kind = 'group') then
    raise exception 'forbidden';
  end if;
  delete from public.conversation_members
  where conversation_id = p_conversation_id and user_id = v_me;
  -- Dacă a plecat proprietarul, cel mai vechi membru devine proprietar.
  if not exists (select 1 from public.conversation_members
                 where conversation_id = p_conversation_id and role = 'owner') then
    update public.conversation_members set role = 'owner'
    where (conversation_id, user_id) in (
      select conversation_id, user_id from public.conversation_members
      where conversation_id = p_conversation_id order by joined_at limit 1);
  end if;
end;
$$;

create function public.mark_read(p_conversation_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.conversation_members set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = (select auth.uid());
$$;

create function public.edit_message(p_message_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.messages set body = p_body, edited_at = now()
  where id = p_message_id and sender_id = auth.uid()
    and deleted_at is null and kind in ('text', 'media');
  if not found then raise exception 'forbidden'; end if;
end;
$$;

-- L10: ștergerea chiar șterge conținutul de pe server, nu doar îl ascunde.
create function public.delete_message(p_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.messages set body = null, deleted_at = now()
  where id = p_message_id and sender_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'forbidden'; end if;
  delete from public.attachments where message_id = p_message_id;
end;
$$;

-- Lista de conversații a utilizatorului curent, cu titlu, ultim mesaj și necitite.
create function public.my_conversations()
returns table (
  id uuid, kind public.conversation_kind, title text,
  last_message_at timestamptz, last_message text, unread_count int, active_call_id uuid
)
language sql stable security definer set search_path = '' as $$
  select
    c.id,
    c.kind,
    coalesce(c.title, (
      select p.display_name
      from public.conversation_members o
      join public.profiles p on p.id = o.user_id
      where o.conversation_id = c.id and o.user_id <> me.user_id
      limit 1), '—'),
    c.last_message_at,
    (select case when m.encryption = 'none' then left(m.body, 120) end
     from public.messages m
     where m.conversation_id = c.id and m.deleted_at is null and m.kind in ('text', 'media')
     order by m.created_at desc limit 1),
    (select count(*)::int from public.messages m
     where m.conversation_id = c.id and m.created_at > me.last_read_at
       and m.sender_id is distinct from me.user_id),
    (select k.id from public.calls k where k.conversation_id = c.id and k.ended_at is null)
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id
  where me.user_id = (select auth.uid())
  order by c.last_message_at desc;
$$;

-- ---------------------------------------------------------------------
-- Apeluri
-- ---------------------------------------------------------------------
create function public.start_call(p_conversation_id uuid, p_kind public.call_kind default 'video')
returns public.calls language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := auth.uid();
  v_call public.calls;
begin
  if not public.can_send(p_conversation_id) then raise exception 'forbidden'; end if;

  select * into v_call from public.calls
  where conversation_id = p_conversation_id and ended_at is null;
  if found then return v_call; end if;

  insert into public.calls (conversation_id, started_by, kind)
  values (p_conversation_id, v_me, p_kind)
  returning * into v_call;

  insert into public.messages (conversation_id, sender_id, kind, body)
  values (p_conversation_id, v_me, 'call', v_call.id::text);

  return v_call;
end;
$$;

-- Apelată de Edge Function-ul livekit-token cu JWT-ul utilizatorului.
-- Este singurul loc unde se decide cine are voie într-o cameră (L7).
create function public.join_call(p_call_id uuid)
returns table (room_name text, kind public.call_kind, identity uuid, display_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := auth.uid();
  v_call public.calls;
begin
  select * into v_call from public.calls c where c.id = p_call_id;
  if not found or not public.can_send(v_call.conversation_id) then
    raise exception 'forbidden';
  end if;
  if v_call.ended_at is not null then raise exception 'call_ended'; end if;
  if v_call.locked
     and v_call.started_by is distinct from v_me
     and not exists (select 1 from public.call_participants cp
                     where cp.call_id = p_call_id and cp.user_id = v_me) then
    raise exception 'call_locked';
  end if;

  insert into public.call_participants (call_id, user_id)
  values (p_call_id, v_me)
  on conflict (call_id, user_id) do update set joined_at = now(), left_at = null;

  return query
    select v_call.room_name, v_call.kind, v_me, p.display_name
    from public.profiles p where p.id = v_me;
end;
$$;

create function public.leave_call(p_call_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
begin
  update public.call_participants set left_at = now()
  where call_id = p_call_id and user_id = v_me and left_at is null;
  -- Ultimul participant care pleacă închide apelul.
  if not exists (select 1 from public.call_participants
                 where call_id = p_call_id and left_at is null) then
    update public.calls set ended_at = now() where id = p_call_id and ended_at is null;
  end if;
end;
$$;

create function public.can_manage_call(p_call_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.calls k
    join public.conversations c on c.id = k.conversation_id
    join public.conversation_members m on m.conversation_id = c.id and m.user_id = (select auth.uid())
    where k.id = p_call_id
      and (c.kind = 'direct' or k.started_by = m.user_id or m.role in ('owner', 'admin'))
  );
$$;

create function public.end_call(p_call_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_call(p_call_id) then raise exception 'forbidden'; end if;
  update public.calls set ended_at = now() where id = p_call_id and ended_at is null;
  update public.call_participants set left_at = now() where call_id = p_call_id and left_at is null;
end;
$$;

create function public.set_call_locked(p_call_id uuid, p_locked boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_call(p_call_id) then raise exception 'forbidden'; end if;
  update public.calls set locked = p_locked where id = p_call_id and ended_at is null;
end;
$$;

-- =====================================================================
-- Row Level Security — L11: accesul e impus în baza de date, nu în aplicație
-- =====================================================================
alter table public.profiles             enable row level security;
alter table public.blocks               enable row level security;
alter table public.devices              enable row level security;
alter table public.push_tokens          enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.attachments          enable row level security;
alter table public.calls                enable row level security;
alter table public.call_participants    enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_conversation(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy blocks_select on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy blocks_insert on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));
create policy blocks_delete on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

create policy devices_select on public.devices for select to authenticated
  using (user_id = (select auth.uid()) or public.shares_conversation(user_id));
create policy devices_insert on public.devices for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy devices_update on public.devices for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy devices_delete on public.devices for delete to authenticated
  using (user_id = (select auth.uid()));

create policy push_tokens_all on public.push_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Conversațiile și membrii se modifică doar prin RPC; clienții pot doar citi.
create policy conversations_select on public.conversations for select to authenticated
  using (public.is_member(id));
create policy members_select on public.conversation_members for select to authenticated
  using (public.is_member(conversation_id));

create policy messages_select on public.messages for select to authenticated
  using (public.is_member(conversation_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and kind in ('text', 'media')
    and public.can_send(conversation_id)
  );

create policy attachments_select on public.attachments for select to authenticated
  using (exists (select 1 from public.messages m
                 where m.id = message_id and public.is_member(m.conversation_id)));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (exists (
    select 1 from public.messages m
    where m.id = message_id and m.sender_id = (select auth.uid())
      and storage_path like m.conversation_id::text || '/%'));

create policy calls_select on public.calls for select to authenticated
  using (public.is_member(conversation_id));
create policy call_participants_select on public.call_participants for select to authenticated
  using (exists (select 1 from public.calls k
                 where k.id = call_id and public.is_member(k.conversation_id)));

-- ---------------------------------------------------------------------
-- Privilegii: vizitatorii anonimi nu au acces la nimic.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, public;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;

-- Coloanele profilului pe care utilizatorul le poate schimba singur.
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_path) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.conversation_members;

-- ---------------------------------------------------------------------
-- Storage — L12: fișierele stau într-un bucket privat; accesul urmează
-- apartenența la conversație (primul folder din cale = id-ul conversației).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 52428800)
on conflict (id) do nothing;

create policy attachments_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'attachments'
         and public.is_member(((storage.foldername(name))[1])::uuid));
create policy attachments_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments'
              and public.can_send(((storage.foldername(name))[1])::uuid));
