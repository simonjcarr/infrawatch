-- Change host_metrics primary key from (id) to (id, recorded_at) so TimescaleDB
-- can partition on recorded_at. Idempotent guards applied since this migration
-- may have been partially applied to the live DB before being recorded.
DO $$
BEGIN
  -- Drop the original single-column PK if it still exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'host_metrics' AND constraint_name = 'host_metrics_pkey'
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE host_metrics DROP CONSTRAINT host_metrics_pkey;
  END IF;

  -- Add the composite PK if it doesn't exist yet
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'host_metrics' AND constraint_name = 'host_metrics_id_recorded_at_pk'
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE host_metrics ADD CONSTRAINT host_metrics_id_recorded_at_pk PRIMARY KEY (id, recorded_at);
  END IF;

  -- Convert to hypertable (migrate_data=true handles existing rows)
  BEGIN
    PERFORM create_hypertable('host_metrics', 'recorded_at', if_not_exists => true, migrate_data => true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TimescaleDB hypertable creation skipped: %', SQLERRM;
  END;

  -- Retention policy
  BEGIN
    PERFORM add_retention_policy('host_metrics', INTERVAL '30 days', if_not_exists => true);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

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
      start_offset      => INTERVAL '3 hours',
      end_offset        => INTERVAL '1 hour',
      schedule_interval => INTERVAL '1 hour',
      if_not_exists     => true
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 1-day continuous aggregate
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
      start_offset      => INTERVAL '3 days',
      end_offset        => INTERVAL '1 day',
      schedule_interval => INTERVAL '1 day',
      if_not_exists     => true
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;
