-- Ensure pg_net extension exists in the expected schema used by triggers
CREATE SCHEMA IF NOT EXISTS net;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA net;