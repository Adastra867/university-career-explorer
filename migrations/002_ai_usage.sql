CREATE TABLE IF NOT EXISTS ai_daily_usage (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day date NOT NULL DEFAULT CURRENT_DATE,
 requests integer NOT NULL CHECK(requests>=0),
 PRIMARY KEY(user_id,day)
);
