-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — ISO company profiles and generator-prompt answers
-- Migration: 014_iso_doc_prompts.sql (plan §5.8, Phase 8c, R12)
--
-- WRITTEN, NEVER APPLIED (hard rule 1). Written ahead of 011–013 (reserved for Phases 11–13) and
-- depends on none of them. Same conventions as 009/010: RLS enabled with zero policies plus an
-- explicit revoke (service role only), no hard delete, optimistic concurrency, every write logged.
--
-- No AI anywhere: these tables only hold what a person typed and confirmed; the prompt itself is
-- built deterministically by api/_isoPrompt.js and never stored (plan D22).
--
-- Safe to run more than once (every CREATE is IF NOT EXISTS / OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════════

-- One profile per client (plan D23), shared by every ISO board for that client. `fields` holds
-- {<key>: {value, confirmed, confirmed_by, confirmed_at}} for single values and
-- {<key>: [{id, text, confirmed, confirmed_by, confirmed_at}, ...]} for lists — each value and each
-- list item is confirmed on its own, and only confirmed ones are ever presented as fact.
create table if not exists iso_company_profiles (
  client_id   text primary key,
  fields      jsonb not null default '{}'::jsonb,
  row_version int not null default 1,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Guided answers for one (board, requirement, template) so a user can come back to them.
create table if not exists iso_prompt_answers (
  id               text primary key,
  audit_id         text not null references iso_audits(id),
  client_id        text not null,
  requirement_id   text not null references iso_requirements(id),
  template_key     text not null,
  template_version text not null,
  answers          jsonb not null default '{}'::jsonb,
  row_version      int not null default 1,
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz not null default now(),
  updated_by       text,
  unique (audit_id, requirement_id, template_key)
);

create index if not exists iso_prompt_answers_audit_idx on iso_prompt_answers(audit_id, requirement_id);

do $$
declare t text;
begin
  for t in select unnest(array['iso_company_profiles','iso_prompt_answers']) loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
    execute format('drop trigger if exists %I on %I', t || '_no_delete', t);
    execute format('create trigger %I before delete on %I for each row execute function iso_no_hard_delete()', t || '_no_delete', t);
  end loop;
end $$;

-- Create-or-update a client's profile with optimistic concurrency (expected 0 = "no profile yet").
-- Logs one activity row per changed key, with before/after, under the client (no audit).
create or replace function iso_upsert_company_profile(
  p_client_id text, p_fields jsonb, p_expected_version int, p_actor_uid text, p_changed_keys text[]
) returns iso_company_profiles
language plpgsql security invoker set search_path = public as $$
declare v_row iso_company_profiles; v_before jsonb; k text;
begin
  select * into v_row from iso_company_profiles where client_id = p_client_id for update;
  if v_row.client_id is null then
    if coalesce(p_expected_version, 0) <> 0 then raise exception 'version_conflict' using errcode = '40001'; end if;
    insert into iso_company_profiles(client_id, fields, created_by, updated_by)
    values (p_client_id, p_fields, p_actor_uid, p_actor_uid) returning * into v_row;
    v_before := '{}'::jsonb;
  else
    if v_row.row_version <> p_expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
    v_before := v_row.fields;
    update iso_company_profiles set fields = p_fields, row_version = row_version + 1, updated_at = now(), updated_by = p_actor_uid
    where client_id = p_client_id returning * into v_row;
  end if;
  foreach k in array coalesce(p_changed_keys, '{}') loop
    perform iso_log(null, p_client_id, 'company_profile', p_client_id, null, 'profile_updated', k,
      v_before -> k, v_row.fields -> k, null, 'user', p_actor_uid, 'staff');
  end loop;
  return v_row;
end;
$$;

-- Save (create or update) the guided answers for one (board, requirement, template), with optimistic
-- concurrency (expected 0 = "none saved yet") and one activity row on the requirement.
create or replace function iso_save_prompt_answers(
  p_id text, p_audit_id text, p_client_id text, p_requirement_id text, p_template_key text,
  p_template_version text, p_answers jsonb, p_expected_version int, p_actor_uid text
) returns iso_prompt_answers
language plpgsql security invoker set search_path = public as $$
declare v_row iso_prompt_answers; v_before jsonb;
begin
  select * into v_row from iso_prompt_answers
   where audit_id = p_audit_id and requirement_id = p_requirement_id and template_key = p_template_key for update;
  if v_row.id is null then
    if coalesce(p_expected_version, 0) <> 0 then raise exception 'version_conflict' using errcode = '40001'; end if;
    insert into iso_prompt_answers(id, audit_id, client_id, requirement_id, template_key, template_version, answers, created_by, updated_by)
    values (p_id, p_audit_id, p_client_id, p_requirement_id, p_template_key, p_template_version, p_answers, p_actor_uid, p_actor_uid)
    returning * into v_row;
    v_before := null;
  else
    if v_row.row_version <> p_expected_version then raise exception 'version_conflict' using errcode = '40001'; end if;
    v_before := v_row.answers;
    update iso_prompt_answers set answers = p_answers, template_version = p_template_version, row_version = row_version + 1,
      updated_at = now(), updated_by = p_actor_uid
     where id = v_row.id returning * into v_row;
  end if;
  perform iso_log(p_audit_id, p_client_id, 'requirement', p_requirement_id, null, 'prompt_answers_saved', p_template_key,
    v_before, v_row.answers, null, 'user', p_actor_uid, 'staff');
  return v_row;
end;
$$;

-- Function lockdown (same as 009's: service role only). Added with plan 8.2 (A82) — 010 and this
-- file had left their functions executable by PUBLIC, Postgres's default. They are security
-- invoker and every table is revoked and RLS-locked, so nothing could actually run through them;
-- this keeps the lockdown explicit, like 009's.
revoke execute on function iso_upsert_company_profile(text,jsonb,int,text,text[]) from public, anon, authenticated;
grant execute on function iso_upsert_company_profile(text,jsonb,int,text,text[]) to service_role;
revoke execute on function iso_save_prompt_answers(text,text,text,text,text,text,jsonb,int,text) from public, anon, authenticated;
grant execute on function iso_save_prompt_answers(text,text,text,text,text,text,jsonb,int,text) to service_role;
