-- Update the password for the existing user with proper hashing
UPDATE public.approved_users 
SET password_hash = crypt('ChangeMe123', gen_salt('bf'))
WHERE email = 'phu.nguyen.gd@gmail.com';