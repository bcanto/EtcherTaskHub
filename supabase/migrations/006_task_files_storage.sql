-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — File storage for task attachments
-- Migration: 006_task_files_storage.sql
--
-- Until now an uploaded file's bytes lived only in the browser that uploaded it, so nobody
-- else — no other staff device, no client — could open it. This creates a private Storage
-- bucket for them. Paths: tasks/<task id>/<file id>.
--
-- Access (same trust split as 005):
--   • Internal staff (public.is_internal(): admin / pm / staff) read and write the bucket
--     directly from the app.
--   • Clients have NO direct access. Their uploads and downloads go through /api/portal-action
--     and /api/portal-file, which check the file belongs to a task they may see and use the
--     service role (which bypasses these policies).
--   • Anonymous: nothing.
--
-- 003_storage_policies.sql is NOT used: it depends on the relational task_files/tasks tables,
-- which are empty. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('task-files', 'task-files', false, 10485760)          -- private, 10 MB per file
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

DROP POLICY IF EXISTS "task-files: internal read"   ON storage.objects;
DROP POLICY IF EXISTS "task-files: internal upload" ON storage.objects;
DROP POLICY IF EXISTS "task-files: internal update" ON storage.objects;
DROP POLICY IF EXISTS "task-files: internal delete" ON storage.objects;

CREATE POLICY "task-files: internal read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'task-files' AND public.is_internal());

CREATE POLICY "task-files: internal upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'task-files' AND public.is_internal());

CREATE POLICY "task-files: internal update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'task-files' AND public.is_internal())
  WITH CHECK (bucket_id = 'task-files' AND public.is_internal());

CREATE POLICY "task-files: internal delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'task-files' AND public.is_internal());

-- ── Check (optional) ──────────────────────────────────────────────────────────
--   select id, public, file_size_limit from storage.buckets where id = 'task-files';
--   select policyname, cmd from pg_policies where tablename = 'objects' and policyname like 'task-files:%';
--
-- ── Rollback ──────────────────────────────────────────────────────────────────
--   DROP POLICY "task-files: internal read" ON storage.objects;   (and the other three)
--   -- the bucket can only be deleted once empty (Storage → task-files → delete files first)
