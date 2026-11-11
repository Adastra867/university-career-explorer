-- Fail migration on invalid historical data instead of silently rewriting it.
ALTER TABLE users ADD CONSTRAINT users_email_normalized
 CHECK (email=lower(btrim(email)) AND length(email) BETWEEN 3 AND 254);
ALTER TABLE user_state ADD CONSTRAINT user_state_version_nonnegative CHECK (version>=0);
ALTER TABLE user_state ADD CONSTRAINT user_state_prep_object CHECK (jsonb_typeof(prep)='object');
ALTER TABLE profiles ADD CONSTRAINT profiles_data_object CHECK (jsonb_typeof(data)='object');
ALTER TABLE assessments ADD CONSTRAINT assessments_data_object CHECK (jsonb_typeof(data)='object');
ALTER TABLE reports ADD CONSTRAINT reports_snapshot_integrity CHECK (
 jsonb_typeof(data)='object' AND length(report_id) BETWEEN 1 AND 100
 AND data ? 'id' AND data->>'id'=report_id
 AND data ? 'snapshot' AND jsonb_typeof(data->'snapshot')='object'
);
ALTER TABLE conversations ADD CONSTRAINT conversations_title_length CHECK (length(btrim(title)) BETWEEN 1 AND 80);
ALTER TABLE messages ADD CONSTRAINT messages_content_length CHECK (length(btrim(content)) BETWEEN 1 AND 12000);
ALTER TABLE messages ADD CONSTRAINT messages_metadata_object CHECK (jsonb_typeof(metadata)='object');
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
