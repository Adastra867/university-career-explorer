-- Service totals survive account deletion, so deleting/recreating an account cannot
-- reset the global daily request budget.
CREATE TABLE IF NOT EXISTS ai_service_usage (
 day date PRIMARY KEY DEFAULT CURRENT_DATE,
 requests integer NOT NULL CHECK(requests>=0)
);
