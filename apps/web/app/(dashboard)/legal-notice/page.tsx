import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Legal Notice',
}

const sections = [
  {
    title: '1. Scope of this notice',
    body: [
      'This legal notice applies to CT-Ops, including the web application, agent, ingest service, reporting, alerting, certificate tooling, service account and identity inventory, directory lookup, password manager launch integration, terminal workspace, scheduled tasks, agent bundles, network tooling, vulnerability and patch reporting, notifications, plugins, integrations, APIs, documentation, deployment scripts, and any related current or future feature made available by CarrTech.',
      'This notice applies to the Community Open Source version, any free or trial use, Enterprise licensed features, support or deployment assistance, and any additional seats, seat packs, upgrades, renewals, or paid usage purchased from CarrTech.',
      'CT-Ops is operational infrastructure software. It can observe, classify, store, transmit, execute, schedule, export, and report on sensitive systems and data. You must use CT-Ops only if you understand those risks and have authority to deploy and operate it in the relevant environment.',
    ],
  },
  {
    title: '2. Licence tiers, seat limits, and paid expansions',
    body: [
      'The Community Open Source version of CT-Ops includes limited use rights and is limited to 3 seats unless CarrTech expressly agrees otherwise in writing. You must not bypass, disable, misrepresent, or work around seat limits, licence checks, feature gates, entitlement controls, or other technical or contractual usage restrictions.',
      'Enterprise licences, advanced features, and purchases of additional seats expand only the specific access, feature, support, or usage rights stated in the applicable order, licence, or written agreement. Buying Enterprise features or additional seats does not create any uptime guarantee, security guarantee, data-loss guarantee, professional-services warranty, indemnity, service credit, or expanded liability from CarrTech unless a separate written agreement signed by CarrTech expressly says so.',
      'You are responsible for monitoring seat allocation, user access, licence expiry, renewals, overuse, unauthorised sharing, and compliance with the licence tier you are using. CarrTech is not responsible for loss, disruption, failed access, disabled features, billing issues, or operational impact arising from expired licences, exceeded seat limits, incorrect seat assignment, failed licence activation, or misuse of Community, trial, Enterprise, or paid-seat entitlements.',
    ],
  },
  {
    title: '3. Use at your own risk',
    body: [
      'You use CT-Ops at your own risk. To the fullest extent permitted by law, CT-Ops is provided on an "as is" and "as available" basis without warranties, representations, conditions, or guarantees of any kind, whether express, implied, statutory, or otherwise.',
      'CarrTech does not warrant that CT-Ops will be uninterrupted, error-free, secure, compatible with your environment, suitable for a particular purpose, compliant with a specific regulatory regime, or free from defects, vulnerabilities, omissions, misconfigurations, malicious code introduced by third parties, data loss, or inaccurate results.',
      'Where United States law applies, CarrTech expressly disclaims all implied warranties to the fullest extent permitted by applicable law, including any implied warranty of merchantability, fitness for a particular purpose, title, quiet enjoyment, non-infringement, accuracy, and any warranty arising from course of dealing, course of performance, or usage of trade.',
    ],
  },
  {
    title: '4. Operational risks',
    body: [
      'CT-Ops can affect production systems if it is configured incorrectly, used carelessly, compromised, or affected by a bug. Things that can go wrong include missed alerts, false alerts, incorrect health status, inaccurate certificate expiry data, incorrect patch or vulnerability assessments, failed agent enrolment, failed agent updates, duplicated or missed task runs, notification delivery failures, report errors, broken integrations, excessive resource usage, network disruption, accidental denial of service, and incomplete audit records.',
      'Features such as terminal access, scheduled tasks, scripts, network checks, certificate checking, directory lookup, service account tracking, password manager launch flows, imports, exports, and future automation or integration features may cause damage if used against the wrong target, with the wrong permissions, at the wrong time, or without appropriate review. You are responsible for all commands, tasks, configuration, scans, checks, imports, exports, integrations, and operational decisions made through CT-Ops.',
    ],
  },
  {
    title: '5. Security, secrets, and data exposure',
    body: [
      'CT-Ops may process hostnames, IP addresses, certificates, user and directory data, service account data, SSH key metadata, software inventories, vulnerability data, patch state, logs, notification configuration, SMTP settings, webhook URLs, tokens, enrolment credentials, session data, licence data, reports, terminal metadata, and other confidential or sensitive information.',
      'Although CarrTech designs CT-Ops with security controls, bugs, deployment mistakes, dependency vulnerabilities, weak passwords, leaked credentials, administrator error, insecure networks, unsafe browser sessions, misconfigured TLS, incorrect access control, logging mistakes, backup exposure, or other failures could expose secrets or customer data. You are responsible for securing your deployment, rotating secrets, restricting access, monitoring activity, maintaining backups, hardening infrastructure, and verifying that CT-Ops is appropriate for your environment.',
    ],
  },
  {
    title: '6. Customer responsibilities',
    body: [
      'You are responsible for installation, configuration, access control, role assignment, network placement, firewall rules, TLS certificates, backups, disaster recovery, database operation, host security, agent deployment, licence management, third-party integrations, legal and regulatory compliance, and all use by your employees, contractors, administrators, agents, service accounts, and other users.',
      'You must test CT-Ops before using it in production, validate alerts and reports against independent sources, maintain appropriate change control, avoid relying on CT-Ops as the sole source of operational truth, and ensure that you have permission to monitor, scan, access, or administer every system you connect to CT-Ops.',
    ],
  },
  {
    title: '7. Exclusion of losses',
    body: [
      'To the fullest extent permitted by law, CarrTech is not liable for any indirect, consequential, special, incidental, exemplary, punitive, or enhanced damages, or for any loss of profit, loss of revenue, loss of business, loss of goodwill, loss of anticipated savings, loss of contracts, business interruption, operational outage, loss of use, loss of data, data corruption, security incident, privacy incident, regulatory fine, remediation cost, incident response cost, loss arising from third-party claims, or cost of substitute software or services.',
      'This exclusion applies whether the alleged liability arises in contract, tort including negligence, breach of statutory duty, misrepresentation, restitution, indemnity, product liability, open-source use, paid subscription, enterprise licence, support arrangement, documentation, deployment assistance, or otherwise, even if CarrTech knew or should have known that such loss was possible.',
    ],
  },
  {
    title: '8. Liability cap for paid customers',
    body: [
      'If you have paid CarrTech for CT-Ops, including for Enterprise features, support, additional seats, seat packs, renewals, or other paid entitlements, then to the fullest extent permitted by law CarrTech\'s total aggregate liability for all claims relating to CT-Ops is limited to the fees actually paid by you to CarrTech for CT-Ops in the twelve months before the event giving rise to the claim. If you have not paid CarrTech for CT-Ops, CarrTech\'s total aggregate liability is limited to GBP 100.',
      'Multiple claims, events, bugs, outages, vulnerabilities, or security incidents do not increase this cap.',
    ],
  },
  {
    title: '9. Third-party systems and dependencies',
    body: [
      'CT-Ops may interact with operating systems, browsers, databases, container runtimes, LDAP or Active Directory, SMTP servers, webhook providers, messaging platforms, package repositories, vulnerability data sources, certificate authorities, network infrastructure, security tools, and other third-party systems. CarrTech is not responsible for those systems, their availability, their security, their output, their terms, or changes they make.',
      'You are responsible for checking third-party licences, export controls, data processing terms, provider limits, acceptable use rules, and operational requirements before connecting CT-Ops to third-party systems or using data produced by them.',
    ],
  },
  {
    title: '10. No professional advice',
    body: [
      'CT-Ops may provide monitoring data, operational status, certificate information, vulnerability context, patch status, service account information, security signals, and reports. This output is informational only. It is not legal, compliance, security, audit, financial, insurance, or professional advice, and it should not be treated as a substitute for qualified human review.',
    ],
  },
  {
    title: '11. Indemnity',
    body: [
      'To the fullest extent permitted by law, you will indemnify and hold CarrTech harmless from claims, losses, liabilities, damages, costs, and expenses including reasonable legal fees arising from your deployment, configuration, administration, misuse, unauthorised use, breach of this notice, breach of law, breach of third-party rights, or use of CT-Ops against systems you do not own or have authority to manage.',
    ],
  },
  {
    title: '12. Jurisdiction-specific rights',
    body: [
      'Some jurisdictions do not allow certain warranty disclaimers, liability exclusions, damages exclusions, indemnities, or liability caps, and some rights may not be waived by contract. In those jurisdictions, the relevant disclaimer, exclusion, indemnity, or cap applies only to the maximum extent permitted by applicable law.',
      'Nothing in this notice excludes or limits liability that cannot legally be excluded or limited, including liability for death or personal injury caused by negligence, fraud, fraudulent misrepresentation, wilful misconduct where it cannot be excluded, or any other liability that applicable law does not allow CarrTech to exclude or limit.',
    ],
  },
  {
    title: '13. Conflicts and changes',
    body: [
      'If you have a separate written agreement signed by CarrTech that expressly overrides this notice, that written agreement controls to the extent of the conflict. Otherwise, this notice applies to your access to and use of CT-Ops.',
      'CarrTech may update this notice from time to time. Continued use of CT-Ops after an updated notice is made available means you accept the updated notice to the fullest extent permitted by law.',
    ],
  },
]

export default function LegalNoticePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">Last updated: 6 May 2026</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Legal notice</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          This notice explains important risk allocation, warranty disclaimer, and liability limitation terms for CT-Ops.
        </p>
      </header>

      <div className="space-y-6 rounded-lg border bg-card p-6 shadow-sm">
        {sections.map((section) => (
          <section key={section.title} className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="text-sm leading-6 text-foreground">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
