CREATE TABLE IF NOT EXISTS household_agent_settings (
  household_id UUID PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  nightly_enabled BOOLEAN NOT NULL DEFAULT true,
  weekly_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO household_agent_settings (household_id, nightly_enabled, weekly_enabled)
SELECT id, true, true
FROM households
ON CONFLICT (household_id) DO NOTHING;
