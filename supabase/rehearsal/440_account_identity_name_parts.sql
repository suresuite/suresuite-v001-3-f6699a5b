-- Account · D209 — THE ACCOUNT HOLDER'S FIRST AND LAST NAME ARE A READING OF
-- `approved_users.name`, NOT WRITABLE ON THEIR OWN, AND THE OWNER CAN CHANGE ONLY
-- THEIR USER NAME.
--
-- §1 the split, stated once: `split_person_name` on the shapes a typed name comes in.
-- §2 the administrator path — a row written with `name` — derives the parts, on
--    INSERT and on a rename; a write to another column leaves them.
-- §3 a write that sets a part directly is overwritten from `name`, so the parts
--    cannot drift from it.
-- §4 the owner, AS anon: update_own_profile changes the user name (display_name) and
--    nothing that identifies the person; it has no parameter that could; and
--    get_my_profile returns both parts with the user id.

DO $d209$
DECLARE
  v_user uuid := gen_random_uuid();
  v_row  record;
BEGIN
  -- ══ §1 · the split ══
  IF public.split_person_name('Ada Lovelace') IS DISTINCT FROM ARRAY['Ada', 'Lovelace'] THEN
    RAISE EXCEPTION 'D209/440 §1: "Ada Lovelace" split as %', public.split_person_name('Ada Lovelace');
  END IF;
  IF public.split_person_name('  Mary Ann   Smith  ') IS DISTINCT FROM ARRAY['Mary', 'Ann   Smith'] THEN
    RAISE EXCEPTION 'D209/440 §1: a padded three-word name split as %', public.split_person_name('  Mary Ann   Smith  ');
  END IF;
  IF public.split_person_name('Plato') IS DISTINCT FROM ARRAY['Plato', NULL] THEN
    RAISE EXCEPTION 'D209/440 §1: a one-word name split as % — the last name must be NULL, not blank', public.split_person_name('Plato');
  END IF;
  IF public.split_person_name('   ') IS DISTINCT FROM ARRAY[NULL, NULL]::text[] THEN
    RAISE EXCEPTION 'D209/440 §1: a blank name split as %', public.split_person_name('   ');
  END IF;

  -- ══ §2 · the administrator path ══
  INSERT INTO public.approved_users (id, name, email, password_hash, role)
  VALUES (v_user, 'Grace Brewster Hopper', 'd209@example.invalid',
          extensions.crypt('a-password', extensions.gen_salt('bf')), 'user');
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.first_name IS DISTINCT FROM 'Grace' OR v_row.last_name IS DISTINCT FROM 'Brewster Hopper'
     OR v_row.name IS DISTINCT FROM 'Grace Brewster Hopper' THEN
    RAISE EXCEPTION 'D209/440 §2: an insert reads first=% last=% name=%', v_row.first_name, v_row.last_name, v_row.name;
  END IF;

  UPDATE public.approved_users SET name = 'Grace Hopper' WHERE id = v_user;
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.first_name IS DISTINCT FROM 'Grace' OR v_row.last_name IS DISTINCT FROM 'Hopper' THEN
    RAISE EXCEPTION 'D209/440 §2: a rename left the parts at first=% last=%', v_row.first_name, v_row.last_name;
  END IF;

  UPDATE public.approved_users SET phone = '+1 555' WHERE id = v_user;
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.first_name IS DISTINCT FROM 'Grace' OR v_row.last_name IS DISTINCT FROM 'Hopper' THEN
    RAISE EXCEPTION 'D209/440 §2: a write to another column moved the parts to % / %', v_row.first_name, v_row.last_name;
  END IF;

  -- ══ §3 · a part written directly does not stick ══
  UPDATE public.approved_users SET first_name = 'Someone', last_name = 'Else' WHERE id = v_user;
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.first_name IS DISTINCT FROM 'Grace' OR v_row.last_name IS DISTINCT FROM 'Hopper'
     OR v_row.name IS DISTINCT FROM 'Grace Hopper' THEN
    RAISE EXCEPTION 'D209/440 §3: writing the parts directly left first=% last=% name=% — they must be re-derived from name',
      v_row.first_name, v_row.last_name, v_row.name;
  END IF;

  -- ══ §4 · the owner changes their user name, and only that ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.update_own_profile(p_display_name => '  gracie ', p_user_id => v_user);
  SELECT * INTO v_row FROM public.get_my_profile(v_user);
  RESET ROLE;
  IF v_row.display_name IS DISTINCT FROM 'gracie' THEN
    RAISE EXCEPTION 'D209/440 §4: the user name reads %, expected gracie', v_row.display_name;
  END IF;
  IF v_row.id IS DISTINCT FROM v_user OR v_row.first_name IS DISTINCT FROM 'Grace'
     OR v_row.last_name IS DISTINCT FROM 'Hopper' OR v_row.name IS DISTINCT FROM 'Grace Hopper' THEN
    RAISE EXCEPTION 'D209/440 §4: after a user-name change get_my_profile reads id=% first=% last=% name=%',
      v_row.id, v_row.first_name, v_row.last_name, v_row.name;
  END IF;

  RAISE NOTICE 'D209/440: first and last name are derived from name on every write, cannot be set on their own, and the owner edits only their user name';
END $d209$;

-- ══ §4 · no self-service parameter reaches the identity ══
DO $d209sig$
DECLARE
  v_args text;
BEGIN
  SELECT string_agg(pg_get_function_arguments(p.oid), ' | ') INTO v_args
    FROM pg_proc p
   WHERE p.proname = 'update_own_profile' AND p.pronamespace = 'public'::regnamespace;
  IF v_args IS NULL THEN
    RAISE EXCEPTION 'D209/440 §4: update_own_profile does not exist';
  END IF;
  IF v_args ~* '\m(p_name|p_first_name|p_last_name)\M' THEN
    RAISE EXCEPTION 'D209/440 §4: update_own_profile takes an identity parameter — %', v_args;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
     WHERE p.oid = 'public.get_my_profile(uuid)'::regprocedure
       AND x.grantee = 'anon'::regrole AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'D209/440 §4: anon is not an EXPLICIT grantee of get_my_profile';
  END IF;
END $d209sig$;
