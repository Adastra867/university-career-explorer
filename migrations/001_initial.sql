CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS user_state (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 0, prep jsonb NOT NULL DEFAULT '{}',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS profiles (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 data jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS assessments (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 data jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS reports (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 report_id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(user_id, report_id)
);
CREATE TABLE IF NOT EXISTS conversations (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('user','assistant')),
 content text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}',
 request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,request_id,role)
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, id DESC);
