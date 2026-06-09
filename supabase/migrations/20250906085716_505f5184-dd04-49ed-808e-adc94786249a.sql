-- Install pg_net into default schema if missing, then create a compatibility wrapper in schema `net`
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE SCHEMA IF NOT EXISTS net;

-- Wrapper to mirror pg_net API at net.http_post for existing triggers
CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  headers jsonb DEFAULT NULL,
  body jsonb DEFAULT NULL,
  timeout_milliseconds integer DEFAULT NULL
) RETURNS TABLE(status integer, headers jsonb, body text)
LANGUAGE sql
AS $fn$
  SELECT (r).status, (r).headers, (r).body
  FROM extensions.http_post(url, headers, body, timeout_milliseconds) AS r;
$fn$;
