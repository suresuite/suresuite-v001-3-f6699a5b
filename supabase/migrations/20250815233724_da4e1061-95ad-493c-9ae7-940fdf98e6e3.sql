BEGIN;

-- Recreate function qualifying pgcrypto calls via extensions schema
CREATE OR REPLACE FUNCTION public.authenticate_approved_user(user_email text, user_password text)
RETURNS TABLE(user_id uuid, user_name text, user_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        au.id,
        au.name,
        au.role
    FROM public.approved_users au
    WHERE au.email = user_email 
    AND au.password_hash = extensions.crypt(user_password, au.password_hash);
END;
$function$;

COMMIT;