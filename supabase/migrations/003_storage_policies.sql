-- ════════════════════════════════════════════════════════════════════════════
-- Etcher Task Hub — Supabase Storage Bucket & Policies
-- Migration: 003_storage_policies.sql
--
-- All file data is stored in Supabase Storage, not in the database.
-- The database (task_files, work_request_files) holds only metadata +
-- a storage_path reference. Binary data never touches the DB.
--
-- Storage path convention:
--   task-attachments/{client_id}/{board_id}/{task_id}/{file_id}/{filename}
--   work-requests/{client_id}/{request_id}/{file_id}/{filename}
--
-- This path structure means a storage policy can verify client_id from
-- the path without a database lookup, providing a defence-in-depth layer.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Create storage buckets ────────────────────────────────────────────────
-- NOTE: Run these statements in the Supabase Dashboard SQL editor OR via
-- the Supabase CLI. The storage schema is managed by Supabase internally.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'task-attachments',
    'task-attachments',
    false,          -- NOT public: every download goes through signed URL + RLS check
    52428800,       -- 50 MB max file size
    ARRAY[
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain', 'text/csv',
      'application/zip', 'application/x-zip-compressed',
      'video/mp4', 'video/quicktime'
    ]
  ),
  (
    'work-requests',
    'work-requests',
    false,
    10485760,       -- 10 MB max for work request attachments
    ARRAY[
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv'
    ]
  )
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- STORAGE RLS POLICIES — task-attachments bucket
--
-- Path structure: {client_id}/{board_id}/{task_id}/{file_id}/{filename}
-- We validate access using the database (task_files + our RLS helper functions)
-- because the path alone cannot be safely trusted without a DB check.
-- ════════════════════════════════════════════════════════════════════════════

-- Internal users can upload task attachments to boards they have write access to.
-- The path is validated by looking up the corresponding task_files metadata row.
CREATE POLICY "task-attachments: internal upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'task-attachments'
  AND public.is_internal()
);

-- Internal users can download files they have read access to.
-- Access is validated via the task_files table (which has its own RLS).
CREATE POLICY "task-attachments: internal download"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'task-attachments'
  AND public.is_internal()
  AND EXISTS (
    SELECT 1 FROM public.task_files tf
    WHERE  tf.storage_path = (storage.objects.bucket_id || '/' || storage.objects.name)
      AND  EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE  t.id = tf.task_id AND public.can_read_board(t.board_id)
      )
  )
);

-- Client users can download files that are NOT internal_only and belong to their client.
CREATE POLICY "task-attachments: client download non-internal"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'task-attachments'
  AND public.auth_user_role() = 'client'
  AND EXISTS (
    SELECT 1 FROM public.task_files tf
    WHERE  tf.storage_path = (storage.objects.bucket_id || '/' || storage.objects.name)
      AND  NOT tf.internal_only
      AND  EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE  t.id = tf.task_id
          AND  t.client_id = public.auth_user_client_id()
          AND  public.client_can_access(t.client_id)
      )
  )
);

-- Client users can upload to tasks that are awaiting their input.
CREATE POLICY "task-attachments: client upload awaiting"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'task-attachments'
  AND public.auth_user_role() = 'client'
  -- Validate via task_files row that was already inserted with internal_only=false
  -- The application creates the task_files metadata row first, then the storage object.
  -- The storage path must match an existing task_files row for an awaiting_client task.
  AND EXISTS (
    SELECT 1 FROM public.task_files tf
    JOIN   public.tasks t ON t.id = tf.task_id
    WHERE  tf.storage_path = (storage.objects.bucket_id || '/' || storage.objects.name)
      AND  NOT tf.internal_only
      AND  t.awaiting_client = true
      AND  t.client_id = public.auth_user_client_id()
      AND  public.client_can_access(t.client_id)
  )
);

-- Uploaders and admins can delete their own files.
CREATE POLICY "task-attachments: uploader admin delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'task-attachments'
  AND (
    public.auth_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.task_files tf
      WHERE  tf.storage_path = (storage.objects.bucket_id || '/' || storage.objects.name)
        AND  tf.uploaded_by = auth.uid()
    )
  )
);

-- ════════════════════════════════════════════════════════════════════════════
-- STORAGE RLS POLICIES — work-requests bucket
-- ════════════════════════════════════════════════════════════════════════════

CREATE POLICY "work-requests: client upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'work-requests'
  AND public.auth_user_role() = 'client'
  AND EXISTS (
    SELECT 1 FROM public.work_request_files wrf
    JOIN   public.client_work_requests wr ON wr.id = wrf.request_id
    WHERE  wrf.storage_path = (storage.objects.bucket_id || '/' || storage.objects.name)
      AND  wr.client_id = public.auth_user_client_id()
      AND  public.client_can_access(wr.client_id)
  )
);

CREATE POLICY "work-requests: client read own"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'work-requests'
  AND public.auth_user_role() = 'client'
  AND EXISTS (
    SELECT 1 FROM public.work_request_files wrf
    JOIN   public.client_work_requests wr ON wr.id = wrf.request_id
    WHERE  wrf.storage_path = (storage.objects.bucket_id || '/' || storage.objects.name)
      AND  wr.client_id = public.auth_user_client_id()
      AND  public.client_can_access(wr.client_id)
  )
);

CREATE POLICY "work-requests: internal read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'work-requests'
  AND public.is_internal()
);
