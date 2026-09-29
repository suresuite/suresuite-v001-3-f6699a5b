-- Account · D207 — A USER EDITS THEIR OWN NAME AS A FIRST AND A LAST NAME, AND
-- `approved_users.name` STAYS THE ONE FULL NAME, WHATEVER WRITES THE ROW.
--
-- §1 the split, stated once: `split_person_name` on the shapes a typed name comes in.
-- §2 the admin path — a row written with `name` only — derives the parts, on INSERT
--    and on a later rename; a row written with parts composes `name`.
-- §3 update_own_profile, AS anon, naming the user: the parts rewrite `name`; NULL
--    leaves a part; a blank last name clears it; a blank first name is refused and
--    changes nothing; get_my_profile returns both parts.
-- §4 the D206 positional signature still works (the parts are appended, not inserted),
--    and anon/authenticated are EXPLICIT grantees of the new signature.

DO $d207$
DECLARE
  v_user uuid := gen_random_uuid();
  v_row  record;
  v_code text;
BEGIN
  -- ══ §1 · the split ══
  IF public.split_person_name('Ada Lovelace') IS DISTINCT FROM ARRAY['Ada', 'Lovelace'] THEN
    RAISE EXCEPTION 'D207/420 §1: "Ada Lovelace" split as %', public.split_person_name('Ada Lovelace');
  END IF;
  IF public.split_person_name('  Mary Ann   Smith  ') IS DISTINCT FROM ARRAY['Mary', 'Ann   Smith'] THEN
    RAISE EXCEPTION 'D207/420 §1: a padded three-word name split as %', public.split_person_name('  Mary Ann   Smith  ');
  END IF;
  IF public.split_person_name('Plato') IS DISTINCT FROM ARRAY['Plato', NULL] THEN
    RAISE EXCEPTION 'D207/420 §1: a one-word name split as % — the last name must be NULL, not blank', public.split_person_name('Plato');
  END IF;
  IF public.split_person_name('   ') IS DISTINCT FROM ARRAY[NULL, NULL]::text[] THEN
    RAISE EXCEPTION 'D207/420 §1: a blank name split as %', public.split_person_name('   ');
  END IF;

  -- ══ §2 · whatever writes the row ══
  INSERT INTO public.approved_users (id, name, email, password_hash, role)
  VALUES (v_user, 'Grace Brewster Hopper', 'd207@example.invalid',
          extensions.crypt('a-password', extensions.gen_salt('bf')), 'user');
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.first_name IS DISTINCT FROM 'Grace' OR v_row.last_name IS DISTINCT FROM 'Brewster Hopper'
     OR v_row.name IS DISTINCT FROM 'Grace Brewster Hopper' THEN
    RAISE EXCEPTION 'D207/420 §2: an insert naming only `name` reads first=% last=% name=%',
      v_row.first_name, v_row.last_name, v_row.name;
  END IF;

  UPDATE public.approved_users SET name = 'Grace Hopper' WHERE id = v_user;   -- an admin rename
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.first_name IS DISTINCT FROM 'Grace' OR v_row.last_name IS DISTINCT FROM 'Hopper' THEN
    RAISE EXCEPTION 'D207/420 §2: a rename left the parts at first=% last=%', v_row.first_name, v_row.last_name;
  END IF;

  UPDATE public.approved_users SET phone = '+1 555' WHERE id = v_user;        -- touches neither
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.name IS DISTINCT FROM 'Grace Hopper' OR v_row.last_name IS DISTINCT FROM 'Hopper' THEN
    RAISE EXCEPTION 'D207/420 §2: a write to another column moved the name to % / %', v_row.name, v_row.last_name;
  END IF;

  -- ══ §3 · the owner's edit, as anon ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.update_own_profile(p_user_id => v_user, p_first_name => '  Mary Ann ', p_last_name => ' van der Berg ');
  RESET ROLE;
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.first_name IS DISTINCT FROM 'Mary Ann' OR v_row.last_name IS DISTINCT FROM 'van der Berg'
     OR v_row.name IS DISTINCT FROM 'Mary Ann van der Berg' THEN
    RAISE EXCEPTION 'D207/420 §3: the edit reads first=% last=% name=% — the parts are what the user typed, trimmed, and `name` follows them',
      v_row.first_name, v_row.last_name, v_row.name;
  END IF;
  IF v_row.phone IS DISTINCT FROM '+1 555' THEN
    RAISE EXCEPTION 'D207/420 §3: a name edit changed the phone to %', v_row.phone;
  END IF;

  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.update_own_profile(p_user_id => v_user, p_first_name => 'Mary');   -- last name: NULL, left
  RESET ROLE;
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.name IS DISTINCT FROM 'Mary van der Berg' THEN
    RAISE EXCEPTION 'D207/420 §3: NULL must leave the last name; name reads %', v_row.name;
  END IF;

  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.update_own_profile(p_user_id => v_user, p_last_name => '');         -- blank clears
  RESET ROLE;
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.last_name IS NOT NULL OR v_row.name IS DISTINCT FROM 'Mary' THEN
    RAISE EXCEPTION 'D207/420 §3: a blank last name left last=% name=%', v_row.last_name, v_row.name;
  END IF;

  PERFORM set_config('app.current_user_id', '', true);
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.update_own_profile(p_user_id => v_user, p_first_name => '   ', p_phone => '+1 999');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'first_name_required' THEN
    RAISE EXCEPTION 'D207/420 §3: a blank first name ended with "%", expected first_name_required', COALESCE(v_code, '(none — it was stored)');
  END IF;
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.name IS DISTINCT FROM 'Mary' OR v_row.phone IS DISTINCT FROM '+1 555' THEN
    RAISE EXCEPTION 'D207/420 §3: the refused write still changed the row: name=% phone=%', v_row.name, v_row.phone;
  END IF;

  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.update_own_profile(p_user_id => v_user, p_first_name => 'Grace', p_last_name => 'Hopper');
  SELECT * INTO v_row FROM public.get_my_profile(v_user);
  RESET ROLE;
  IF v_row.first_name IS DISTINCT FROM 'Grace' OR v_row.last_name IS DISTINCT FROM 'Hopper'
     OR v_row.name IS DISTINCT FROM 'Grace Hopper' OR v_row.id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'D207/420 §3: get_my_profile reads id=% first=% last=% name=%',
      v_row.id, v_row.first_name, v_row.last_name, v_row.name;
  END IF;

  -- ══ §4 · the D206 positional call still resolves ══
  PERFORM set_config('app.current_user_id', '', true);
  SET LOCAL ROLE anon;
  PERFORM public.update_own_profile('Gracie', NULL, NULL, v_user);
  RESET ROLE;
  SELECT * INTO v_row FROM public.approved_users WHERE id = v_user;
  IF v_row.display_name IS DISTINCT FROM 'Gracie' OR v_row.name IS DISTINCT FROM 'Grace Hopper' THEN
    RAISE EXCEPTION 'D207/420 §4: the four-argument call reads display=% name=%', v_row.display_name, v_row.name;
  END IF;

  RAISE NOTICE 'D207/420: first and last name are one fact with approved_users.name — derived on an admin write, composed on the owner''s, a blank first name refused';
END $d207$;

DO $d207grants$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
       WHERE p.oid = 'public.update_own_profile(text, text, text, uuid, text, text)'::regprocedure
         AND x.grantee = v_role::regrole AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'D207/420 §4: % is not an EXPLICIT grantee of update_own_profile', v_role;
    END IF;
  END LOOP;
  IF to_regprocedure('public.update_own_profile(text, text, text, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'D207/420 §4: the D206 four-argument overload survived — PostgREST cannot choose between two';
  END IF;
END $d207grants$;
