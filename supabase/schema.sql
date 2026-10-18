-- =====================================================================
-- WorldPulse — Supabase schema, security policies and API functions
-- =====================================================================
-- Run this whole file once in the Supabase SQL editor (or `psql`), then
-- run supabase/seed_countries.sql. It is idempotent: re-running it
-- upgrades functions in place without touching stored data.
--
-- Security model
--   * Raw data lives in the `private` schema, which is NOT exposed by the
--     Supabase Data API. Row Level Security is enabled on every table with
--     no policies for `anon`/`authenticated`, so even if the schema were
--     exposed by mistake no rows could be read or written directly.
--   * The browser can only call the SECURITY DEFINER functions in
--     `public` listed at the bottom of this file. They validate input,
--     enforce rate limits, moderate text and return aggregates only.
--   * Timestamps are server-generated (`now()`, stored as timestamptz/UTC).
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema private from anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------
create table if not exists private.countries (
  code char(2) primary key check (code ~ '^[A-Z]{2}$'),
  name text not null
);

create table if not exists private.moods (
  code      text primary key,
  label     text not null,
  emoji     text not null,
  valence   text not null check (valence in ('positive', 'neutral', 'negative')),
  sort      int  not null
);

insert into private.moods (code, label, emoji, valence, sort) values
  ('happy',      'Happy',      '😄', 'positive', 1),
  ('loved',      'Loved',      '🥰', 'positive', 2),
  ('calm',       'Calm',       '😌', 'positive', 3),
  ('excited',    'Excited',    '🤩', 'positive', 4),
  ('okay',       'Okay',       '😐', 'neutral',  5),
  ('sad',        'Sad',        '😔', 'negative', 6),
  ('anxious',    'Anxious',    '😰', 'negative', 7),
  ('frustrated', 'Frustrated', '😡', 'negative', 8),
  ('tired',      'Tired',      '😴', 'neutral',  9),
  ('hopeful',    'Hopeful',    '🤍', 'positive', 10)
on conflict (code) do update
  set label = excluded.label, emoji = excluded.emoji, valence = excluded.valence, sort = excluded.sort;

-- Operational settings. `hash_salt` is generated once and never leaves the database.
create table if not exists private.settings (
  key   text primary key,
  value text not null
);

insert into private.settings (key, value) values
  ('hash_salt',             encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex')),
  ('auto_approve_messages', 'false'), -- 'true' publishes messages that pass the automatic filters without review
  ('min_country_group',     '10'),    -- minimum submissions before a country breakdown is shown
  ('retention_days',        '90'),    -- mood submissions older than this are deleted
  ('message_retention_days','30'),    -- messages (and their reports) older than this are deleted
  ('auto_hide_reports',     '3')      -- approved messages are hidden after this many distinct reports
on conflict (key) do nothing;

-- Terms that cause a public message to be rejected automatically.
-- Extend this list for your community (insert into private.blocked_terms values ('...')).
create table if not exists private.blocked_terms (
  term text primary key check (term = lower(term))
);

insert into private.blocked_terms (term) values
  ('fuck'), ('shit'), ('bitch'), ('cunt'), ('nigger'), ('nigga'), ('faggot'), ('retard'),
  ('kill yourself'), ('kys'), ('rape'), ('nazi'), ('porn'), ('nude'), ('onlyfans'),
  ('telegram'), ('whatsapp'), ('crypto'), ('bitcoin'), ('casino'), ('viagra')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Raw data (never readable by the public)
-- ---------------------------------------------------------------------
create table if not exists private.mood_submissions (
  id           uuid primary key default gen_random_uuid(),
  mood         text not null references private.moods (code),
  country_code char(2) not null references private.countries (code),
  created_at   timestamptz not null default now()
);

-- Messages are stored separately from the mood itself so aggregate
-- statistics never touch free text, and messages can be deleted on a
-- shorter schedule than moods.
create table if not exists private.mood_messages (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references private.mood_submissions (id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 140),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'hidden')),
  report_count  int  not null default 0,
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);

create table if not exists private.message_reports (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references private.mood_messages (id) on delete cascade,
  reason        text not null check (reason in ('spam', 'abusive', 'personal_info', 'self_harm', 'other')),
  reporter_hash text not null,
  created_at    timestamptz not null default now(),
  unique (message_id, reporter_hash)
);

-- Short-lived rate-limit ledger. `subject` is a salted SHA-256 hash of the
-- browser's random client token or of the request IP, rotated daily.
-- Rows are deleted after 48 hours by private.purge_old_data().
create table if not exists private.rate_limit_events (
  id         bigint generated always as identity primary key,
  subject    text not null,
  action     text not null,
  created_at timestamptz not null default now()
);

create index if not exists mood_submissions_created_idx         on private.mood_submissions (created_at desc);
create index if not exists mood_submissions_country_created_idx on private.mood_submissions (country_code, created_at desc);
create index if not exists mood_submissions_mood_created_idx    on private.mood_submissions (mood, created_at desc);
create index if not exists mood_messages_status_created_idx     on private.mood_messages (status, created_at desc);
create index if not exists rate_limit_events_lookup_idx         on private.rate_limit_events (subject, action, created_at desc);
create index if not exists rate_limit_events_created_idx        on private.rate_limit_events (created_at);

alter table private.countries         enable row level security;
alter table private.moods             enable row level security;
alter table private.settings          enable row level security;
alter table private.blocked_terms     enable row level security;
alter table private.mood_submissions  enable row level security;
alter table private.mood_messages     enable row level security;
alter table private.message_reports   enable row level security;
alter table private.rate_limit_events enable row level security;
-- Deliberately no policies: only the table owner (used by the SECURITY
-- DEFINER functions below) and the service role can touch these rows.

-- ---------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------
create or replace function private.setting(p_key text)
returns text language sql stable set search_path = '' as $$
  select value from private.settings where key = p_key
$$;

create or replace function private.window_interval(p_window text)
returns interval language sql immutable set search_path = '' as $$
  select case p_window
    when '1h'  then interval '1 hour'
    when '24h' then interval '24 hours'
    when '7d'  then interval '7 days'
    when '30d' then interval '30 days'
  end
$$;

-- Bucket size for timelines in each window.
create or replace function private.window_bucket(p_window text)
returns interval language sql immutable set search_path = '' as $$
  select case p_window
    when '1h'  then interval '5 minutes'
    when '24h' then interval '1 hour'
    when '7d'  then interval '6 hours'
    when '30d' then interval '1 day'
  end
$$;

-- Salted, daily-rotating hash. The raw value is never stored.
create or replace function private.subject_hash(p_value text)
returns text language sql stable set search_path = '' as $$
  select encode(sha256(convert_to(
    coalesce(p_value, '') || ':' || private.setting('hash_salt') || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
    'UTF8')), 'hex')
$$;

-- First address from X-Forwarded-For as passed through by the Supabase API gateway.
create or replace function private.request_ip()
returns text language plpgsql stable set search_path = '' as $$
declare
  v_headers json;
begin
  v_headers := nullif(current_setting('request.headers', true), '')::json;
  return nullif(trim(split_part(coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip', ''), ',', 1)), '');
exception when others then
  return null;
end $$;

-- Returns true and records the event when `subject` has made fewer than
-- `p_max` `p_action` calls in the last `p_per`.
create or replace function private.rate_limit_ok(p_subject text, p_action text, p_max int, p_per interval)
returns boolean language plpgsql volatile set search_path = '' as $$
declare
  v_count int;
begin
  if p_subject is null then
    return true;
  end if;
  select count(*) into v_count
    from private.rate_limit_events
   where subject = p_subject and action = p_action and created_at > now() - p_per;
  return v_count < p_max;
end $$;

create or replace function private.record_event(p_subject text, p_action text)
returns void language sql volatile set search_path = '' as $$
  insert into private.rate_limit_events (subject, action)
  select p_subject, p_action where p_subject is not null
$$;

-- Normalises a public message and decides whether it may be stored.
-- Returns (clean text, verdict) where verdict is 'ok' or a rejection reason.
create or replace function private.screen_message(p_raw text, out clean text, out verdict text)
language plpgsql stable set search_path = '' as $$
declare
  v_lower text;
  v_term  text;
begin
  -- Strip control characters and zero-width characters, collapse whitespace.
  clean := regexp_replace(coalesce(p_raw, ''), '[\x00-\x1F\x7F​-‏ -‮⁠-⁯﻿]', ' ', 'g');
  clean := btrim(regexp_replace(clean, '\s+', ' ', 'g'));

  if clean = '' then
    clean := null; verdict := 'empty'; return;
  end if;
  if char_length(clean) > 140 then
    verdict := 'too_long'; return;
  end if;

  v_lower := lower(clean);

  if v_lower ~ '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|io|co|ru|xyz|info|biz|me|ly|gg|app|link|site|top)\M)' then
    verdict := 'contains_link'; return;
  end if;
  if v_lower ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' or v_lower ~ '(^|\s)@[a-z0-9_.]{3,}' then
    verdict := 'contains_contact'; return;
  end if;
  if regexp_replace(v_lower, '[^0-9]', '', 'g') ~ '[0-9]{7,}' then
    verdict := 'contains_number'; return;
  end if;
  if v_lower ~ '(.)\1{7,}' then
    verdict := 'spam'; return;
  end if;
  if clean ~ '[<>]' then
    verdict := 'markup'; return;
  end if;

  for v_term in select term from private.blocked_terms loop
    if v_lower ~ ('\m' || regexp_replace(v_term, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M') then
      verdict := 'blocked_term'; return;
    end if;
  end loop;

  verdict := 'ok';
end $$;

-- Mood distribution for a set of rows, always listing every mood (count 0 if absent).
create or replace function private.distribution(p_country text, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('mood', m.code, 'count', coalesce(s.n, 0)) order by m.sort), '[]'::jsonb)
    from private.moods m
    left join (
      select mood, count(*) as n
        from private.mood_submissions
       where created_at >= p_from and created_at < p_to
         and (p_country is null or country_code = p_country)
       group by mood
    ) s on s.mood = m.code
$$;

create or replace function private.timeline(p_country text, p_window text)
returns jsonb language sql stable set search_path = '' as $$
  with params as (
    select private.window_bucket(p_window) as bucket,
           now() - private.window_interval(p_window) as since
  ),
  buckets as (
    select generate_series(
             date_bin(p.bucket, p.since, timestamptz '2000-01-01'),
             now(),
             p.bucket) as t
      from params p
  ),
  counts as (
    select date_bin(p.bucket, s.created_at, timestamptz '2000-01-01') as t,
           count(*) as total,
           count(*) filter (where m.valence = 'positive') as positive,
           count(*) filter (where m.valence = 'negative') as negative
      from private.mood_submissions s
      join private.moods m on m.code = s.mood
      cross join params p
     where s.created_at >= p.since
       and (p_country is null or s.country_code = p_country)
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           't', b.t,
           'total', coalesce(c.total, 0),
           'positive', coalesce(c.positive, 0),
           'negative', coalesce(c.negative, 0)) order by b.t), '[]'::jsonb)
    from buckets b
    left join counts c on c.t = b.t
$$;

-- ---------------------------------------------------------------------
-- Public API (callable with the anon key)
-- ---------------------------------------------------------------------

-- Submit a mood. Returns JSON: { ok, error?, message_status?, retry_after? }
--   p_client_token: random UUID kept in the visitor's browser, used only
--                   (salted + hashed) for rate limiting.
--   p_website:      honeypot field; real browsers leave it empty.
create or replace function public.submit_mood(
  p_mood         text,
  p_country      text,
  p_message      text default null,
  p_client_token text default null,
  p_website      text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_token_hash text;
  v_ip_hash    text;
  v_country    text := upper(btrim(coalesce(p_country, '')));
  v_mood       text := lower(btrim(coalesce(p_mood, '')));
  v_screen     record;
  v_id         uuid;
  v_msg_status text := 'none';
begin
  -- Honeypot: pretend success, store nothing.
  if coalesce(p_website, '') <> '' then
    return jsonb_build_object('ok', true, 'message_status', 'none');
  end if;

  if not exists (select 1 from private.moods where code = v_mood) then
    return jsonb_build_object('ok', false, 'error', 'invalid_mood');
  end if;
  if v_country !~ '^[A-Z]{2}$' or not exists (select 1 from private.countries where code = v_country) then
    return jsonb_build_object('ok', false, 'error', 'invalid_country');
  end if;
  if p_client_token is null or p_client_token !~ '^[A-Za-z0-9-]{16,64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_client');
  end if;
  if p_message is not null and char_length(p_message) > 500 then
    return jsonb_build_object('ok', false, 'error', 'message_too_long');
  end if;

  v_token_hash := private.subject_hash('token:' || p_client_token);
  v_ip_hash    := case when private.request_ip() is null then null
                       else private.subject_hash('ip:' || private.request_ip()) end;

  -- Serialise concurrent submissions from the same browser.
  perform pg_advisory_xact_lock(hashtextextended(v_token_hash, 0));

  if not private.rate_limit_ok(v_token_hash, 'submit', 1, interval '60 seconds') then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after', 60);
  end if;
  if not private.rate_limit_ok(v_token_hash, 'submit', 12, interval '24 hours') then
    return jsonb_build_object('ok', false, 'error', 'daily_limit');
  end if;
  -- Generous per-network limit so shared connections (schools, offices) still work.
  if not private.rate_limit_ok(v_ip_hash, 'submit', 60, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after', 600);
  end if;

  insert into private.mood_submissions (mood, country_code)
  values (v_mood, v_country)
  returning id into v_id;

  if p_message is not null and btrim(p_message) <> '' then
    select * into v_screen from private.screen_message(p_message);
    if v_screen.verdict = 'ok' and private.rate_limit_ok(v_token_hash, 'message', 5, interval '24 hours') then
      v_msg_status := case when private.setting('auto_approve_messages') = 'true' then 'approved' else 'pending' end;
      insert into private.mood_messages (submission_id, body, status, reviewed_at)
      values (v_id, v_screen.clean, v_msg_status, case when v_msg_status = 'approved' then now() end);
      perform private.record_event(v_token_hash, 'message');
    else
      -- Rejected text is discarded, never stored.
      v_msg_status := 'rejected';
    end if;
  end if;

  perform private.record_event(v_token_hash, 'submit');
  perform private.record_event(v_ip_hash, 'submit');

  return jsonb_build_object('ok', true, 'message_status', v_msg_status);
end $$;

-- Global aggregate statistics for a time window ('1h', '24h', '7d', '30d').
create or replace function public.get_global_stats(p_window text default '24h')
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_span  interval := private.window_interval(p_window);
  v_now   timestamptz := now();
  v_total bigint;
  v_prev  bigint;
  v_countries bigint;
begin
  if v_span is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_window');
  end if;

  select count(*), count(distinct country_code) into v_total, v_countries
    from private.mood_submissions where created_at >= v_now - v_span;
  select count(*) into v_prev
    from private.mood_submissions where created_at >= v_now - 2 * v_span and created_at < v_now - v_span;

  return jsonb_build_object(
    'ok', true,
    'window', p_window,
    'generated_at', v_now,
    'total', v_total,
    'countries', v_countries,
    'distribution', private.distribution(null, v_now - v_span, v_now + interval '1 second'),
    'previous_total', v_prev,
    'previous_distribution', private.distribution(null, v_now - 2 * v_span, v_now - v_span),
    'timeline', private.timeline(null, p_window),
    'last_submission_at', (select date_trunc('minute', max(created_at)) from private.mood_submissions)
  );
end $$;

-- Per-country marker data for the globe. Countries below the privacy
-- threshold are reported only as "has activity", without counts or moods.
create or replace function public.get_country_markers(p_window text default '24h', p_mood text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_span interval := private.window_interval(p_window);
  v_min  int := private.setting('min_country_group')::int;
begin
  if v_span is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_window');
  end if;
  if p_mood is not null and not exists (select 1 from private.moods where code = p_mood) then
    return jsonb_build_object('ok', false, 'error', 'invalid_mood');
  end if;

  return jsonb_build_object('ok', true, 'threshold', v_min, 'markers', coalesce((
    with per_country as (
      select country_code, mood, count(*) as n
        from private.mood_submissions
       where created_at >= now() - v_span
       group by country_code, mood
    ),
    totals as (
      select country_code,
             sum(n)::bigint as total,
             (array_agg(mood order by n desc, mood))[1] as top_mood,
             coalesce(sum(n) filter (where mood = p_mood), 0)::bigint as mood_n
        from per_country
       group by country_code
    )
    select jsonb_agg(case
             when total >= v_min then jsonb_build_object(
               'code', country_code, 'suppressed', false, 'total', total,
               'top_mood', top_mood,
               'mood_share', case when p_mood is null then null else round(mood_n::numeric / total, 4) end)
             else jsonb_build_object('code', country_code, 'suppressed', true)
           end)
      from totals
  ), '[]'::jsonb));
end $$;

-- Detailed statistics for one country, suppressed below the threshold.
create or replace function public.get_country_stats(p_country text, p_window text default '24h')
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_span    interval := private.window_interval(p_window);
  v_code    text := upper(btrim(coalesce(p_country, '')));
  v_min     int := private.setting('min_country_group')::int;
  v_now     timestamptz := now();
  v_total   bigint;
  v_prev    bigint;
  v_last    timestamptz;
begin
  if v_span is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_window');
  end if;
  if not exists (select 1 from private.countries where code = v_code) then
    return jsonb_build_object('ok', false, 'error', 'invalid_country');
  end if;

  select count(*), max(created_at) into v_total, v_last
    from private.mood_submissions
   where country_code = v_code and created_at >= v_now - v_span;
  select count(*) into v_prev
    from private.mood_submissions
   where country_code = v_code and created_at >= v_now - 2 * v_span and created_at < v_now - v_span;

  if v_total < v_min then
    return jsonb_build_object(
      'ok', true, 'code', v_code, 'window', p_window, 'generated_at', v_now,
      'suppressed', true, 'threshold', v_min, 'has_activity', v_total > 0);
  end if;

  return jsonb_build_object(
    'ok', true, 'code', v_code, 'window', p_window, 'generated_at', v_now,
    'suppressed', false, 'threshold', v_min,
    'total', v_total,
    'distribution', private.distribution(v_code, v_now - v_span, v_now + interval '1 second'),
    'previous_total', case when v_prev >= v_min then v_prev end,
    'previous_distribution', case when v_prev >= v_min
                                  then private.distribution(v_code, v_now - 2 * v_span, v_now - v_span) end,
    'timeline', private.timeline(v_code, p_window),
    'last_updated', date_trunc('minute', v_last)
  );
end $$;

-- Recent public activity: mood, country, approved message only, minute precision.
create or replace function public.get_recent_activity(p_limit int default 20)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'items', coalesce(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb))
    from (
      select s.mood,
             s.country_code,
             date_trunc('minute', s.created_at) as created_at,
             case when m.status = 'approved' then m.id end   as message_id,
             case when m.status = 'approved' then m.body end as message
        from private.mood_submissions s
        left join private.mood_messages m on m.submission_id = s.id
       where s.created_at >= now() - interval '7 days'
       order by s.created_at desc
       limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) r
$$;

-- Report a public message. Messages with enough distinct reports are hidden
-- automatically until a moderator reviews them.
create or replace function public.report_message(p_message_id uuid, p_reason text, p_client_token text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_hash  text;
  v_count int;
begin
  if p_reason not in ('spam', 'abusive', 'personal_info', 'self_harm', 'other') then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;
  if p_client_token is null or p_client_token !~ '^[A-Za-z0-9-]{16,64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_client');
  end if;
  if not exists (select 1 from private.mood_messages where id = p_message_id and status = 'approved') then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_hash := private.subject_hash('token:' || p_client_token);
  if not private.rate_limit_ok(v_hash, 'report', 20, interval '24 hours') then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  insert into private.message_reports (message_id, reason, reporter_hash)
  values (p_message_id, p_reason, v_hash)
  on conflict (message_id, reporter_hash) do nothing;

  if found then
    perform private.record_event(v_hash, 'report');
    update private.mood_messages
       set report_count = report_count + 1,
           status = case when report_count + 1 >= private.setting('auto_hide_reports')::int
                              or p_reason = 'personal_info'
                         then 'hidden' else status end
     where id = p_message_id
     returning report_count into v_count;
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Moderation (for project owners: SQL editor / service role only)
-- ---------------------------------------------------------------------
create or replace view private.moderation_queue as
  select m.id, m.body, m.status, m.report_count, m.created_at, s.mood, s.country_code,
         (select array_agg(distinct r.reason) from private.message_reports r where r.message_id = m.id) as report_reasons
    from private.mood_messages m
    join private.mood_submissions s on s.id = m.submission_id
   where m.status = 'pending' or (m.status = 'hidden' and m.report_count > 0)
   order by m.created_at;

create or replace function private.moderate_message(p_id uuid, p_status text)
returns void language plpgsql volatile set search_path = '' as $$
begin
  if p_status not in ('approved', 'rejected', 'hidden') then
    raise exception 'status must be approved, rejected or hidden';
  end if;
  update private.mood_messages set status = p_status, reviewed_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------
create or replace function private.purge_old_data()
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_moods bigint; v_msgs bigint; v_events bigint;
begin
  delete from private.mood_messages
   where created_at < now() - make_interval(days => private.setting('message_retention_days')::int);
  get diagnostics v_msgs = row_count;

  delete from private.mood_submissions
   where created_at < now() - make_interval(days => private.setting('retention_days')::int);
  get diagnostics v_moods = row_count;

  delete from private.rate_limit_events where created_at < now() - interval '48 hours';
  get diagnostics v_events = row_count;

  return jsonb_build_object('moods', v_moods, 'messages', v_msgs, 'rate_limit_events', v_events);
end $$;

-- Schedule the purge daily at 03:17 UTC when pg_cron is enabled
-- (Dashboard → Database → Extensions → pg_cron). Re-run this file afterwards.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'worldpulse-retention';
    perform cron.schedule('worldpulse-retention', '17 3 * * *', 'select private.purge_old_data()');
  else
    raise notice 'pg_cron is not enabled: schedule private.purge_old_data() manually (see README).';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Realtime: broadcast a content-free "pulse" event on every new mood or
-- newly approved message. Clients refetch aggregates; no row data is sent.
-- ---------------------------------------------------------------------
create or replace function private.broadcast_pulse()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(jsonb_build_object('at', now()), 'pulse', 'worldpulse-pulse', false);
  exception when others then
    -- Realtime unavailable: clients fall back to polling. Never block the insert.
    null;
  end;
  return null;
end $$;

drop trigger if exists mood_submissions_pulse on private.mood_submissions;
create trigger mood_submissions_pulse
  after insert on private.mood_submissions
  for each statement execute function private.broadcast_pulse();

drop trigger if exists mood_messages_pulse on private.mood_messages;
create trigger mood_messages_pulse
  after update of status on private.mood_messages
  for each statement execute function private.broadcast_pulse();

-- ---------------------------------------------------------------------
-- Privileges: expose exactly the public API functions.
-- ---------------------------------------------------------------------
revoke all on all tables    in schema private from public;
revoke all on all functions in schema private from public;

revoke all on function public.submit_mood(text, text, text, text, text) from public;
revoke all on function public.get_global_stats(text)                    from public;
revoke all on function public.get_country_markers(text, text)           from public;
revoke all on function public.get_country_stats(text, text)             from public;
revoke all on function public.get_recent_activity(int)                  from public;
revoke all on function public.report_message(uuid, text, text)          from public;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema private from anon, authenticated';
    execute 'revoke all on all functions in schema private from anon, authenticated';
    execute 'grant execute on function public.submit_mood(text, text, text, text, text) to anon, authenticated';
    execute 'grant execute on function public.get_global_stats(text)                    to anon, authenticated';
    execute 'grant execute on function public.get_country_markers(text, text)           to anon, authenticated';
    execute 'grant execute on function public.get_country_stats(text, text)             to anon, authenticated';
    execute 'grant execute on function public.get_recent_activity(int)                  to anon, authenticated';
    execute 'grant execute on function public.report_message(uuid, text, text)          to anon, authenticated';
  end if;
end $$;
