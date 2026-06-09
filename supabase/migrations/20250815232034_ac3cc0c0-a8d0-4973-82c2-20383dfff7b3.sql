-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Insert a test user with proper password hashing
INSERT INTO public.users (id, name, email, role, password_hash)
VALUES (
  gen_random_uuid(),
  'Admin User',
  'admin@example.com',
  'admin',
  crypt('password123', gen_salt('bf'))
)
ON CONFLICT (email) DO NOTHING;