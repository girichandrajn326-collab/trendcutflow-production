-- Force PostgREST to reload its schema cache so the `credits` column
-- on the `users` table becomes visible to the REST API immediately.
NOTIFY pgrst, 'reload schema';