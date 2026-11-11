-- Teste de securitate și comportament. Orice eșec oprește scriptul (ON_ERROR_STOP).
\set ON_ERROR_STOP on

create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
end $$;

-- Rulează o comandă și verifică faptul că e respinsă.
create function pg_temp.must_fail(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok   - % (respins: %)', p_label, sqlerrm;
    return;
  end;
  raise exception 'FAIL - %: comanda trebuia respinsă', p_label;
end $$;

create function pg_temp.check_that(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL - %', p_label; end if;
  raise notice 'ok   - %', p_label;
end $$;

insert into auth.users (id, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', '{"username":"ana","display_name":"Ana"}'),
  ('00000000-0000-0000-0000-00000000000b', '{"username":"Bogdan"}'),
  ('00000000-0000-0000-0000-00000000000c', '{"username":"ana"}'),          -- username ocupat
  ('00000000-0000-0000-0000-00000000000d', '{"username":"x"}');            -- username invalid

select pg_temp.check_that((select count(*) = 4 from public.profiles), 'profil creat automat la înregistrare');
select pg_temp.check_that((select username = 'bogdan' from public.profiles where id::text like '%b'), 'username normalizat la litere mici');
select pg_temp.check_that((select username like 'user_%' from public.profiles where id::text like '%c'), 'username ocupat -> rezervă');
select pg_temp.check_that((select username like 'user_%' from public.profiles where id::text like '%d'), 'username invalid -> rezervă');

\set ana    '''00000000-0000-0000-0000-00000000000a'''
\set bogdan '''00000000-0000-0000-0000-00000000000b'''
\set carol  '''00000000-0000-0000-0000-00000000000c'''
\set dan    '''00000000-0000-0000-0000-00000000000d'''

-- ---------- anonim ----------
set role anon;
select pg_temp.must_fail('select * from public.profiles', 'anonim nu citește profiluri');
select pg_temp.must_fail('select * from public.find_user(''ana'')', 'anonim nu poate căuta utilizatori');
reset role;

-- ---------- Ana ----------
set role authenticated;
select pg_temp.login(:ana);
select pg_temp.check_that((select count(*) = 1 from public.profiles), 'Ana vede doar profilul ei (fără enumerare)');
select pg_temp.check_that((select count(*) = 1 from public.find_user('BOGDAN')), 'căutare după username exact');
select pg_temp.check_that((select count(*) = 0 from public.find_user('bog')), 'căutarea parțială nu întoarce nimic');
select pg_temp.must_fail('insert into public.conversations (kind, title) values (''group'', ''x'')', 'conversațiile nu se creează direct');
select pg_temp.must_fail(format('select public.create_direct_conversation(%L)', :ana), 'fără conversație cu sine');

select public.create_direct_conversation(:bogdan) as conv_ab \gset
select pg_temp.check_that(public.create_direct_conversation(:bogdan) = :'conv_ab', 'conversația directă e unică per pereche');
select pg_temp.check_that((select count(*) = 2 from public.profiles), 'Ana vede acum și profilul lui Bogdan');

insert into public.messages (conversation_id, body, client_id, created_at)
values (:'conv_ab', 'Salut!', '11111111-1111-1111-1111-111111111111', '2000-01-01');
select pg_temp.check_that((select created_at > now() - interval '1 minute' from public.messages where body = 'Salut!'), 'timpul mesajului e pus de server');
select pg_temp.must_fail(format('insert into public.messages (conversation_id, body, client_id) values (%L, ''dublură'', ''11111111-1111-1111-1111-111111111111'')', :'conv_ab'), 'retrimiterea cu același client_id nu dublează mesajul');
select pg_temp.must_fail(format('insert into public.messages (conversation_id, body, sender_id) values (%L, ''fals'', %L)', :'conv_ab', :bogdan), 'nu poți trimite în numele altcuiva');
select pg_temp.must_fail(format('insert into public.messages (conversation_id, body, kind) values (%L, ''fals'', ''system'')', :'conv_ab'), 'clienții nu pot crea mesaje de sistem');
update public.messages set body = 'modificat';
select pg_temp.check_that((select count(*) = 0 from public.messages where body = 'modificat'), 'mesajele nu se modifică direct');
select pg_temp.must_fail('update public.profiles set id = gen_random_uuid()', 'id-ul profilului nu se poate schimba');
update public.profiles set display_name = 'Ana M.' where id = :ana;

-- ---------- Carol (străină de conversație) ----------
select pg_temp.login(:carol);
select pg_temp.check_that((select count(*) = 0 from public.messages), 'Carol nu vede mesajele altora');
select pg_temp.check_that((select count(*) = 0 from public.conversations), 'Carol nu vede conversațiile altora');
select pg_temp.must_fail(format('insert into public.messages (conversation_id, body) values (%L, ''intrus'')', :'conv_ab'), 'Carol nu poate scrie într-o conversație străină');
select pg_temp.must_fail(format('select public.start_call(%L)', :'conv_ab'), 'Carol nu poate porni apel într-o conversație străină');
select pg_temp.must_fail(format('select public.create_group(''spam'', array[%L]::uuid[])', :ana), 'nu poți băga într-un grup un necunoscut');
select pg_temp.must_fail(format('insert into storage.objects (bucket_id, name) values (''attachments'', %L)', :'conv_ab' || '/poza.jpg'), 'Carol nu poate urca fișiere într-o conversație străină');

-- ---------- Bogdan ----------
select pg_temp.login(:bogdan);
select pg_temp.check_that((select count(*) = 1 from public.messages), 'Bogdan vede mesajul Anei');
select pg_temp.check_that((select unread_count = 1 and title = 'Ana M.' from public.my_conversations()), 'lista de conversații: titlu și necitite');
select public.mark_read(:'conv_ab');
select pg_temp.check_that((select unread_count = 0 from public.my_conversations()), 'marcare ca citit');
select pg_temp.must_fail(format('select public.delete_message(%L)', (select id from public.messages limit 1)), 'nu poți șterge mesajul altcuiva');
insert into storage.objects (bucket_id, name) values ('attachments', :'conv_ab' || '/poza.jpg');
select pg_temp.check_that((select count(*) = 1 from storage.objects), 'membrul poate urca și vedea fișiere');

-- ---------- Apeluri ----------
select (public.start_call(:'conv_ab', 'video')).id as call_id \gset
select pg_temp.check_that((public.start_call(:'conv_ab', 'audio')).id = :'call_id', 'un singur apel activ per conversație');
select pg_temp.check_that((select room_name like 'call_%' and identity = :bogdan from public.join_call(:'call_id')), 'membrul primește camera');
select public.set_call_locked(:'call_id', true);

select pg_temp.login(:carol);
select pg_temp.must_fail(format('select * from public.join_call(%L)', :'call_id'), 'Carol nu poate intra în apel (fără zoombombing)');
select pg_temp.check_that((select count(*) = 0 from public.calls), 'Carol nu vede apelul');

select pg_temp.login(:ana);
select pg_temp.must_fail(format('select * from public.join_call(%L)', :'call_id'), 'camera blocată nu mai primește participanți noi');
select pg_temp.login(:bogdan);
select public.set_call_locked(:'call_id', false);
select pg_temp.login(:ana);
select pg_temp.check_that((select count(*) = 1 from public.join_call(:'call_id')), 'după deblocare Ana intră');
select public.leave_call(:'call_id');
select pg_temp.check_that((select ended_at is null from public.calls where id = :'call_id'), 'apelul continuă cât mai e cineva');
select pg_temp.login(:bogdan);
select public.leave_call(:'call_id');
select pg_temp.check_that((select ended_at is not null from public.calls where id = :'call_id'), 'ultimul care pleacă închide apelul');
select pg_temp.must_fail(format('select * from public.join_call(%L)', :'call_id'), 'nu se poate intra într-un apel încheiat');

-- ---------- Grupuri ----------
select pg_temp.login(:ana);
select public.create_group('Familia', array[:bogdan]::uuid[]) as grp \gset
select pg_temp.check_that((select count(*) = 2 from public.conversation_members where conversation_id = :'grp'), 'grup creat cu un contact existent');
select pg_temp.must_fail(format('select public.add_member(%L, %L)', :'grp', :dan), 'în grup intră doar contacte existente');
select pg_temp.login(:bogdan);
select pg_temp.must_fail(format('select public.add_member(%L, %L)', :'grp', :ana), 'membrul simplu nu poate adăuga oameni');
select pg_temp.login(:ana);
select public.leave_conversation(:'grp');
select pg_temp.login(:bogdan);
select pg_temp.check_that((select role = 'owner' from public.conversation_members where conversation_id = :'grp'), 'proprietatea trece mai departe la plecare');

-- ---------- Ștergere și blocare ----------
select pg_temp.login(:ana);
select public.delete_message((select id from public.messages where body = 'Salut!'));
select pg_temp.check_that((select count(*) = 1 from public.messages where body is null and deleted_at is not null and kind = 'text'), 'ștergerea elimină conținutul de pe server');

insert into public.blocks (blocker_id, blocked_id) values (:ana, :bogdan);
select pg_temp.login(:bogdan);
select pg_temp.must_fail(format('insert into public.messages (conversation_id, body) values (%L, ''alo?'')', :'conv_ab'), 'utilizatorul blocat nu mai poate scrie');
select pg_temp.must_fail(format('select public.start_call(%L)', :'conv_ab'), 'utilizatorul blocat nu mai poate suna');
select pg_temp.check_that((select count(*) = 0 from public.find_user('ana')), 'utilizatorul blocat nu te mai găsește');
select pg_temp.check_that((select count(*) = 0 from public.blocks), 'cel blocat nu vede lista de blocări');

-- ---------- Anti-spam ----------
select pg_temp.login(:carol);
select public.create_direct_conversation(:dan) as conv_cd \gset
select pg_temp.must_fail(format('insert into public.messages (conversation_id, body) select %L, ''spam '' || g from generate_series(1, 40) g', :'conv_cd'), 'limitare de viteză la trimitere');

reset role;
\echo 'TOATE TESTELE AU TRECUT'
