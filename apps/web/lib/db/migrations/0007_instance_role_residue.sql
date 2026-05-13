UPDATE "user"
SET role = 'instance_admin'
WHERE role = 'org_admin';
--> statement-breakpoint
UPDATE "user"
SET roles = COALESCE(
  (
    SELECT jsonb_agg(
      to_jsonb(CASE value WHEN 'org_admin' THEN 'instance_admin' ELSE value END)
    )
    FROM jsonb_array_elements_text(roles) AS role_values(value)
  ),
  '[]'::jsonb
)
WHERE roles ? 'org_admin';
--> statement-breakpoint
UPDATE "invitations"
SET role = 'instance_admin'
WHERE role = 'org_admin';
--> statement-breakpoint
UPDATE "invitations"
SET roles = COALESCE(
  (
    SELECT jsonb_agg(
      to_jsonb(CASE value WHEN 'org_admin' THEN 'instance_admin' ELSE value END)
    )
    FROM jsonb_array_elements_text(roles) AS role_values(value)
  ),
  '[]'::jsonb
)
WHERE roles ? 'org_admin';
--> statement-breakpoint
UPDATE "instance_settings"
SET metadata = replace(metadata::text, '"org_admin"', '"instance_admin"')::jsonb
WHERE metadata::text LIKE '%"org_admin"%';
--> statement-breakpoint
ALTER INDEX IF EXISTS "alert_instances_org_status_idx" RENAME TO "alert_instances_instance_status_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "alert_rules_org_enabled_idx" RENAME TO "alert_rules_instance_enabled_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "alert_rules_org_global_idx" RENAME TO "alert_rules_instance_global_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "alert_rules_org_host_idx" RENAME TO "alert_rules_instance_host_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "alert_silences_org_active_idx" RENAME TO "alert_silences_instance_active_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "alert_silences_org_host_idx" RENAME TO "alert_silences_instance_host_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "audit_events_org_time_idx" RENAME TO "audit_events_instance_time_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "build_doc_asset_storage_settings_org_uidx" RENAME TO "build_doc_asset_storage_settings_instance_uidx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "build_doc_snippets_org_updated_idx" RENAME TO "build_doc_snippets_instance_updated_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "build_doc_templates_org_active_idx" RENAME TO "build_doc_templates_instance_active_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "build_docs_org_updated_idx" RENAME TO "build_docs_instance_updated_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "calendar_event_hosts_org_host_idx" RENAME TO "calendar_event_hosts_instance_host_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "calendar_event_participants_org_user_idx" RENAME TO "calendar_event_participants_instance_user_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "calendar_events_org_client_request_idx" RENAME TO "calendar_events_instance_client_request_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "calendar_events_org_range_idx" RENAME TO "calendar_events_instance_range_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "calendar_events_org_series_idx" RENAME TO "calendar_events_instance_series_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "calendar_events_org_series_occurrence_idx" RENAME TO "calendar_events_instance_series_occurrence_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "cert_events_org_time_idx" RENAME TO "cert_events_instance_time_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "certificates_org_expiry_idx" RENAME TO "certificates_instance_expiry_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "certificates_org_host_idx" RENAME TO "certificates_instance_host_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "certificates_org_status_idx" RENAME TO "certificates_instance_status_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "checks_org_host_idx" RENAME TO "checks_instance_host_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "docker_container_lifecycle_events_org_container_time_idx" RENAME TO "docker_container_lifecycle_events_instance_container_time_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "docker_container_lifecycle_events_org_host_time_idx" RENAME TO "docker_container_lifecycle_events_instance_host_time_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "docker_container_metrics_org_container_time_idx" RENAME TO "docker_container_metrics_instance_container_time_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "docker_container_metrics_org_host_time_idx" RENAME TO "docker_container_metrics_instance_host_time_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "docker_containers_org_host_present_seen_idx" RENAME TO "docker_containers_instance_host_present_seen_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "docker_containers_org_image_idx" RENAME TO "docker_containers_instance_image_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "domain_accounts_org_status_idx" RENAME TO "domain_accounts_instance_status_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "domain_accounts_org_username_idx" RENAME TO "domain_accounts_instance_username_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "host_docker_status_org_status_checked_idx" RENAME TO "host_docker_status_instance_status_checked_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "host_metrics_org_host_time_idx" RENAME TO "host_metrics_instance_host_time_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "host_package_updates_org_status_idx" RENAME TO "host_package_updates_instance_status_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "host_patch_statuses_org_status_idx" RENAME TO "host_patch_statuses_instance_status_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "host_vuln_findings_org_status_idx" RENAME TO "host_vuln_findings_instance_status_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "identity_events_org_time_idx" RENAME TO "identity_events_instance_time_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "notes_org_active_updated_idx" RENAME TO "notes_instance_active_updated_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "notification_channels_org_enabled_idx" RENAME TO "notification_channels_instance_enabled_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "notifications_org_user_idx" RENAME TO "notifications_instance_user_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "service_accounts_org_host_idx" RENAME TO "service_accounts_instance_host_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "service_accounts_org_status_idx" RENAME TO "service_accounts_instance_status_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "service_accounts_org_type_idx" RENAME TO "service_accounts_instance_type_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "ssh_keys_org_fingerprint_idx" RENAME TO "ssh_keys_instance_fingerprint_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "ssh_keys_org_host_idx" RENAME TO "ssh_keys_instance_host_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "ssh_keys_org_status_idx" RENAME TO "ssh_keys_instance_status_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "ssh_keys_org_type_idx" RENAME TO "ssh_keys_instance_type_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "sw_pkg_org_name_idx" RENAME TO "sw_pkg_instance_name_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "tags_org_key_idx" RENAME TO "tags_instance_key_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "tags_org_key_value_ci_uidx" RENAME TO "tags_instance_key_value_ci_uidx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "terminal_sessions_org_host_idx" RENAME TO "terminal_sessions_instance_host_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "users_org_active_deleted_name_email_idx" RENAME TO "users_instance_active_deleted_name_email_idx";
