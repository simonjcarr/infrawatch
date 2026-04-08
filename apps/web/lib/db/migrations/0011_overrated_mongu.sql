ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "metric_retention_days" integer DEFAULT 30 NOT NULL;

-- TimescaleDB continuous aggregates for host_metrics
-- Wrapped in exception handlers so plain PostgreSQL deployments continue to work.
DO $$
BEGIN
  -- 1-hour continuous aggregate
  BEGIN
    EXECUTE '
      CREATE MATERIALIZED VIEW host_metrics_hourly
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket(''1 hour''::interval, recorded_at) AS bucket,
        organisation_id,
        host_id,
        AVG(cpu_percent)::real    AS cpu_percent,
        AVG(memory_percent)::real AS memory_percent,
        AVG(disk_percent)::real   AS disk_percent
      FROM host_metrics
      GROUP BY bucket, organisation_id, host_id
      WITH NO DATA
    ';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM add_continuous_aggregate_policy(
      'host_metrics_hourly',
      start_offset    => INTERVAL '3 hours',
      end_offset      => INTERVAL '1 hour',
      schedule_interval => INTERVAL '1 hour',
      if_not_exists   => true
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 1-day continuous aggregate (built on top of the raw hypertable)
  BEGIN
    EXECUTE '
      CREATE MATERIALIZED VIEW host_metrics_daily
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket(''1 day''::interval, recorded_at) AS bucket,
        organisation_id,
        host_id,
        AVG(cpu_percent)::real    AS cpu_percent,
        AVG(memory_percent)::real AS memory_percent,
        AVG(disk_percent)::real   AS disk_percent
      FROM host_metrics
      GROUP BY bucket, organisation_id, host_id
      WITH NO DATA
    ';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM add_continuous_aggregate_policy(
      'host_metrics_daily',
      start_offset    => INTERVAL '3 days',
      end_offset      => INTERVAL '1 day',
      schedule_interval => INTERVAL '1 day',
      if_not_exists   => true
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;