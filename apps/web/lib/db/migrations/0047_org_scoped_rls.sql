DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT
      quote_ident(c.table_schema) AS schema_name,
      quote_ident(c.table_name) AS table_name
    FROM information_schema.columns c
    INNER JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organisation_id'
      AND t.table_type = 'BASE TABLE'
    GROUP BY c.table_schema, c.table_name
  LOOP
    EXECUTE format('ALTER TABLE %s.%s ENABLE ROW LEVEL SECURITY', target.schema_name, target.table_name);
    EXECUTE format('ALTER TABLE %s.%s FORCE ROW LEVEL SECURITY', target.schema_name, target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS org_scoped_access ON %s.%s', target.schema_name, target.table_name);
    EXECUTE format(
      'CREATE POLICY org_scoped_access ON %1$s.%2$s USING (
        current_setting(''app.organisation_id'', true) IS NULL
        OR organisation_id = current_setting(''app.organisation_id'', true)
        OR organisation_id IS NULL
      ) WITH CHECK (
        current_setting(''app.organisation_id'', true) IS NULL
        OR organisation_id = current_setting(''app.organisation_id'', true)
        OR organisation_id IS NULL
      )',
      target.schema_name,
      target.table_name
    );
  END LOOP;
END
$$;
