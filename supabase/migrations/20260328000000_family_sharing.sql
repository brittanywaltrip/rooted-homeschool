-- ─── Family Sharing v2 ────────────────────────────────────────────────────────
-- Replaces the old email-based family_invites with a single shareable link
-- per family, plus reactions, comments, and notifications.

-- Drop old table if it exists (old schema had email-based invites)
DROP TABLE IF EXISTS memory_reactions CASCADE;
DROP TABLE IF EXISTS family_invites CASCADE;

-- Family invite tokens (one per mom, regeneratable)
CREATE TABLE IF NOT EXISTS family_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  label text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT family_invites_user_id_key UNIQUE (user_id)
);
ALTER TABLE family_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON family_invites
  FOR ALL USING (auth.uid() = user_id);

-- Memory reactions (from family members — no account needed)
CREATE TABLE IF NOT EXISTS memory_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  family_token uuid NOT NULL REFERENCES family_invites(token) ON DELETE CASCADE,
  reactor_name text NOT NULL,
  reactor_key text NOT NULL,
  emoji text NOT NULL CHECK (emoji IN ('❤️','😂','😮','🥹','👏')),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT one_reaction_per_person UNIQUE (memory_id, reactor_key, emoji)
);
ALTER TABLE memory_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "family_insert_reactions" ON memory_reactions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM family_invites WHERE token = family_token)
  );
CREATE POLICY "owner_read_reactions" ON memory_reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM family_invites fi
      JOIN memories m ON m.user_id = fi.user_id
      WHERE fi.token = family_token AND m.id = memory_id
        AND m.user_id = auth.uid()
    )
  );
CREATE POLICY "family_read_reactions" ON memory_reactions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM family_invites WHERE token = family_token)
  );

-- Memory comments
CREATE TABLE IF NOT EXISTS memory_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  family_token uuid NOT NULL REFERENCES family_invites(token) ON DELETE CASCADE,
  commenter_name text NOT NULL,
  commenter_key text NOT NULL,
  body text NOT NULL CHECK (char_length(body) <= 500),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE memory_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "family_insert_comments" ON memory_comments
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM family_invites WHERE token = family_token)
  );
CREATE POLICY "owner_read_comments" ON memory_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM family_invites fi
      JOIN memories m ON m.user_id = fi.user_id
      WHERE fi.token = family_token AND m.id = memory_id
        AND m.user_id = auth.uid()
    )
  );
CREATE POLICY "family_read_comments" ON memory_comments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM family_invites WHERE token = family_token)
  );

-- Family notifications (mom sees when family reacts)
CREATE TABLE IF NOT EXISTS family_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  memory_id uuid REFERENCES memories(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('reaction', 'comment')),
  actor_name text NOT NULL,
  emoji text,
  preview text,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE family_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_notifications" ON family_notifications
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "family_insert_notifications" ON family_notifications
  FOR INSERT WITH CHECK (true);
