ALTER TABLE public."session" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public."session" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS org_scoped_user_access ON public."session";
--> statement-breakpoint
CREATE POLICY org_scoped_user_access ON public."session" USING (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public."user" auth_user
    WHERE auth_user.id = "session".user_id
      AND auth_user.organisation_id = current_setting('app.organisation_id', true)
  )
) WITH CHECK (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public."user" auth_user
    WHERE auth_user.id = "session".user_id
      AND auth_user.organisation_id = current_setting('app.organisation_id', true)
  )
);
--> statement-breakpoint
ALTER TABLE public."account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public."account" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS org_scoped_user_access ON public."account";
--> statement-breakpoint
CREATE POLICY org_scoped_user_access ON public."account" USING (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public."user" auth_user
    WHERE auth_user.id = "account".user_id
      AND auth_user.organisation_id = current_setting('app.organisation_id', true)
  )
) WITH CHECK (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public."user" auth_user
    WHERE auth_user.id = "account".user_id
      AND auth_user.organisation_id = current_setting('app.organisation_id', true)
  )
);
--> statement-breakpoint
ALTER TABLE public.totp_credential ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.totp_credential FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS org_scoped_user_access ON public.totp_credential;
--> statement-breakpoint
CREATE POLICY org_scoped_user_access ON public.totp_credential USING (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public."user" auth_user
    WHERE auth_user.id = totp_credential.user_id
      AND auth_user.organisation_id = current_setting('app.organisation_id', true)
  )
) WITH CHECK (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public."user" auth_user
    WHERE auth_user.id = totp_credential.user_id
      AND auth_user.organisation_id = current_setting('app.organisation_id', true)
  )
);
--> statement-breakpoint
ALTER TABLE public.verification ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.verification FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS org_scoped_verification_access ON public.verification;
--> statement-breakpoint
CREATE POLICY org_scoped_verification_access ON public.verification USING (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public."user" auth_user
    WHERE auth_user.organisation_id = current_setting('app.organisation_id', true)
      AND (
        lower(auth_user.email) = lower(verification.identifier)
        OR (
          verification.identifier LIKE 'ldap-2fa-%'
          AND verification.value IS JSON OBJECT
          AND auth_user.id = (verification.value::jsonb ->> 'userId')
        )
      )
  )
) WITH CHECK (
  current_setting('app.organisation_id', true) IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public."user" auth_user
    WHERE auth_user.organisation_id = current_setting('app.organisation_id', true)
      AND (
        lower(auth_user.email) = lower(verification.identifier)
        OR (
          verification.identifier LIKE 'ldap-2fa-%'
          AND verification.value IS JSON OBJECT
          AND auth_user.id = (verification.value::jsonb ->> 'userId')
        )
      )
  )
);
