-- Safety net: unarchive any children that were incorrectly archived for paying subscribers
UPDATE children SET archived = false
WHERE archived = true
AND user_id IN (
  SELECT id FROM profiles
  WHERE is_pro = true
  OR subscription_status = 'active'
);
