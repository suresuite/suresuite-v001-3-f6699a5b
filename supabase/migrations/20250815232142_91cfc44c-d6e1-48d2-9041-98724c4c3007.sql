-- Enable pgcrypto for password hashing used by authenticate_approved_user
CREATE EXTENSION IF NOT EXISTS pgcrypto;