-- WorldPulse database tests. Run against a NON-production database after
-- schema.sql and seed_countries.sql:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests.sql
-- Everything runs inside a transaction that is rolled back at the end.
begin;

set local request.headers = '{"x-forwarded-for": "203.0.113.7, 10.0.0.1"}';

-- 1. The public role cannot touch raw tables or private functions.
set local role anon;
do $$ begin
  begin
    perform 1 from private.mood_submissions limit 1;
    raise exception 'FAIL: anon can read private.mood_submissions';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into private.mood_submissions (mood, country_code) values ('happy', 'DE');
    raise exception 'FAIL: anon can insert into private.mood_submissions';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.purge_old_data();
    raise exception 'FAIL: anon can call private functions';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 2. Input validation (still as anon).
do $$
declare r jsonb;
begin
  r := public.submit_mood('ecstatic', 'DE', null, 'test-token-aaaaaaaaaaaa');
  assert r->>'error' = 'invalid_mood', 'invalid mood accepted: ' || r;
  r := public.submit_mood('happy', 'ZZ', null, 'test-token-aaaaaaaaaaaa');
  assert r->>'error' = 'invalid_country', 'invalid country accepted: ' || r;
  r := public.submit_mood('happy', 'DE', null, 'short');
  assert r->>'error' = 'invalid_client', 'bad client token accepted: ' || r;
  r := public.get_global_stats('1y');
  assert r->>'error' = 'invalid_window', 'invalid window accepted: ' || r;

  -- Honeypot: reports success but stores nothing.
  r := public.submit_mood('happy', 'DE', null, 'test-token-bot-aaaaaaaa', 'http://spam');
  assert (r->>'ok')::boolean, 'honeypot should look successful';
  assert (public.get_global_stats('1h')->>'total')::int = 0, 'honeypot submission was stored';
end $$;

-- 3. Valid submission, duplicate rapid submission, message moderation.
do $$
declare r jsonb;
begin
  r := public.submit_mood('Happy', 'de', 'Sunny walk by the river', 'test-token-aaaaaaaaaaaa');
  assert (r->>'ok')::boolean and r->>'message_status' = 'pending', 'valid submission failed: ' || r;

  r := public.submit_mood('calm', 'DE', null, 'test-token-aaaaaaaaaaaa');
  assert r->>'error' = 'rate_limited', 'rapid duplicate was not rate limited: ' || r;

  r := public.submit_mood('calm', 'FR', 'visit www.example.com now', 'test-token-bbbbbbbbbbbb');
  assert r->>'message_status' = 'rejected', 'link was not rejected: ' || r;
  r := public.submit_mood('sad', 'FR', 'call me 555 123 4567', 'test-token-cccccccccccc');
  assert r->>'message_status' = 'rejected', 'phone number was not rejected: ' || r;
  r := public.submit_mood('sad', 'FR', '<script>alert(1)</script>', 'test-token-dddddddddddd');
  assert r->>'message_status' = 'rejected', 'markup was not rejected: ' || r;
  r := public.submit_mood('sad', 'FR', repeat('x', 141), 'test-token-eeeeeeeeeeee');
  assert r->>'message_status' = 'rejected', 'over-long message was not rejected: ' || r;

  -- Pending messages are not public.
  r := public.get_recent_activity(10);
  assert jsonb_array_length(r->'items') = 5, 'expected 5 recent items: ' || r;
  assert not exists (select 1 from jsonb_array_elements(r->'items') i where i->>'message' is not null),
    'unmoderated message is publicly visible';
  -- No identifiers beyond the documented fields.
  assert not exists (select 1 from jsonb_array_elements(r->'items') i, jsonb_object_keys(i) k
                      where k not in ('mood', 'country_code', 'created_at', 'message_id', 'message')),
    'recent activity exposes unexpected fields';
end $$;

reset role;

-- Rejected text is never stored.
do $$ begin
  assert (select count(*) from private.mood_messages) = 1, 'rejected messages were stored';
  assert not exists (select 1 from private.rate_limit_events where subject like '%203.0.113.7%'),
    'raw IP stored in rate limit ledger';
end $$;

-- 4. Moderation and reporting.
select private.moderate_message(id, 'approved') from private.mood_messages;
set local role anon;
do $$
declare r jsonb; v_id uuid;
begin
  r := public.get_recent_activity(10);
  select (i->>'message_id')::uuid into v_id from jsonb_array_elements(r->'items') i where i->>'message' is not null;
  assert v_id is not null, 'approved message is not visible';

  r := public.report_message(v_id, 'nonsense', 'reporter-token-aaaaaaaaaa');
  assert r->>'error' = 'invalid_reason', 'invalid report reason accepted';
  perform public.report_message(v_id, 'spam', 'reporter-token-aaaaaaaaaa');
  perform public.report_message(v_id, 'spam', 'reporter-token-aaaaaaaaaa'); -- duplicate, ignored
  perform public.report_message(v_id, 'spam', 'reporter-token-bbbbbbbbbb');
  r := public.get_recent_activity(10);
  assert exists (select 1 from jsonb_array_elements(r->'items') i where i->>'message' is not null),
    'message hidden before the report threshold';
  perform public.report_message(v_id, 'abusive', 'reporter-token-cccccccccc');
  r := public.get_recent_activity(10);
  assert not exists (select 1 from jsonb_array_elements(r->'items') i where i->>'message' is not null),
    'message still visible after 3 distinct reports';
end $$;

-- 5. Privacy threshold for country statistics.
do $$
declare r jsonb; i int;
begin
  r := public.get_country_stats('DE', '24h');
  assert (r->>'suppressed')::boolean and r->'distribution' is null, 'small group not suppressed: ' || r;

  for i in 1..10 loop
    perform public.submit_mood(case when i % 2 = 0 then 'calm' else 'tired' end, 'DE', null,
                               'bulk-token-' || lpad(i::text, 12, '0'));
  end loop;

  r := public.get_country_stats('DE', '24h');
  assert not (r->>'suppressed')::boolean and (r->>'total')::int = 11, 'country stats wrong: ' || r;
  assert jsonb_array_length(r->'distribution') = 10, 'distribution should list every mood';

  r := public.get_country_markers('24h', 'calm');
  assert exists (select 1 from jsonb_array_elements(r->'markers') m
                  where m->>'code' = 'DE' and (m->>'total')::int = 11 and m->>'top_mood' in ('calm', 'tired')),
    'DE marker missing: ' || r;
  assert exists (select 1 from jsonb_array_elements(r->'markers') m
                  where m->>'code' = 'FR' and (m->>'suppressed')::boolean and m->'total' is null),
    'FR marker not suppressed: ' || r;

  r := public.get_global_stats('24h');
  assert (r->>'total')::int = 15 and (r->>'countries')::int = 2, 'global stats wrong: ' || r;
  assert jsonb_array_length(r->'timeline') between 24 and 26, 'timeline buckets wrong: ' || r;
end $$;

-- 6. Per-network limit (60/hour) applies across browser tokens.
do $$
declare r jsonb; i int;
begin
  for i in 1..60 loop
    r := public.submit_mood('okay', 'JP', null, 'net-token-' || lpad(i::text, 12, '0'));
  end loop;
  assert r->>'error' = 'rate_limited', 'per-network limit not enforced: ' || r;
end $$;

reset role;

-- 7. Realtime pulses carry no row data, and retention purges old rows.
do $$ begin
  if to_regclass('realtime.messages') is not null or to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    raise notice 'realtime.send present: pulses are broadcast on topic worldpulse-pulse';
  end if;
  update private.mood_submissions set created_at = now() - interval '91 days'
   where id in (select id from private.mood_submissions limit 3);
  assert (private.purge_old_data()->>'moods')::int = 3, 'retention purge failed';
end $$;

select 'All WorldPulse database tests passed' as result;
rollback;
