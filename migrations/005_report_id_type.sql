-- PostgreSQL CHECK accepts NULL, so existence alone is not enough: a JSON null
-- id would otherwise make equality unknown and pass the check.
ALTER TABLE reports DROP CONSTRAINT reports_snapshot_integrity;
ALTER TABLE reports ADD CONSTRAINT reports_snapshot_integrity CHECK (
 jsonb_typeof(data)='object' AND length(report_id) BETWEEN 1 AND 100
 AND data ? 'id' AND jsonb_typeof(data->'id')='string' AND data->>'id'=report_id
 AND data ? 'snapshot' AND jsonb_typeof(data->'snapshot')='object'
);
