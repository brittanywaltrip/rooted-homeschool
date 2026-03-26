-- Grant full pro/founding access to admin account
UPDATE profiles
SET is_pro = true,
    plan_type = 'founding_family',
    subscription_status = 'active',
    family_name = 'The Waltrip Family'
WHERE id = 'd18ca881-a776-4e82-b145-832adc88a88a';
