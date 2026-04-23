-- Bulletproof partner attribution.
--
-- Adds a single atomic RPC that owns every write to profiles.referred_by and
-- the referrals ledger. Both paths (URL ?ref= on signup, Stripe coupon at
-- checkout, and free→paid conversion) must call this so the DB is never
-- left with referred_by set but no referrals row, or a referrals row with
-- stale converted/stripe_session_id.
--
-- The function runs inside an implicit transaction, so all side effects
-- succeed or fail together.

CREATE OR REPLACE FUNCTION public.record_referral_attribution(
  p_user_id uuid,
  p_affiliate_code text,
  p_stripe_session_id text DEFAULT NULL,
  p_converted boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text := UPPER(TRIM(COALESCE(p_affiliate_code, '')));
  v_affiliate_exists boolean;
  v_profile_referred_by text;
  v_existing_id uuid;
  v_action text;
BEGIN
  IF v_code = '' THEN
    RAISE EXCEPTION 'affiliate_code required';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  SELECT EXISTS (SELECT 1 FROM affiliates WHERE UPPER(code) = v_code)
    INTO v_affiliate_exists;
  IF NOT v_affiliate_exists THEN
    RAISE EXCEPTION 'Unknown affiliate code: %', p_affiliate_code;
  END IF;

  -- Only set referred_by if it isn't already claimed — first referrer wins.
  SELECT referred_by INTO v_profile_referred_by FROM profiles WHERE id = p_user_id;
  IF v_profile_referred_by IS NULL THEN
    UPDATE profiles SET referred_by = v_code WHERE id = p_user_id;
  END IF;

  SELECT id INTO v_existing_id
    FROM referrals
   WHERE user_id = p_user_id AND UPPER(affiliate_code) = v_code
   LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO referrals (affiliate_code, user_id, stripe_session_id, converted)
    VALUES (v_code, p_user_id, p_stripe_session_id, COALESCE(p_converted, false));
    v_action := CASE WHEN p_converted THEN 'inserted_converted' ELSE 'inserted' END;
  ELSE
    UPDATE referrals
       SET converted = (converted OR COALESCE(p_converted, false)),
           stripe_session_id = COALESCE(p_stripe_session_id, stripe_session_id)
     WHERE id = v_existing_id;
    v_action := CASE WHEN p_converted THEN 'converted' ELSE 'updated' END;
  END IF;

  RETURN jsonb_build_object(
    'action', v_action,
    'affiliate_code', v_code,
    'user_id', p_user_id
  );
END;
$$;

-- Service role only — the function writes to arbitrary users' rows.
REVOKE ALL ON FUNCTION public.record_referral_attribution(uuid, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_referral_attribution(uuid, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.record_referral_attribution(uuid, text, text, boolean) FROM authenticated;

-- Speeds up the (user_id, affiliate_code) lookup used by the upsert branch.
CREATE INDEX IF NOT EXISTS referrals_user_code_idx
  ON public.referrals (user_id, UPPER(affiliate_code));
