-- The Strava Edge Functions use the server (service_role) key. This project does not grant
-- table privileges to service_role by default, so grant exactly what the functions need.
-- Clients (anon/authenticated) are unaffected: they keep no access to connections or OAuth
-- states, and read-only access to their own activities via RLS.

grant select, insert, update, delete on table public.strava_connections to service_role;
grant select, insert, update, delete on table public.strava_oauth_states to service_role;
-- Activities are soft-deleted (the id stays reserved), so no DELETE is needed.
grant select, insert, update on table public.strava_activities to service_role;
