import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    padding: 32,
    color: '#111827',
  },
  header: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingBottom: 10,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 3,
  },
  subtitle: {
    fontSize: 9,
    color: '#6b7280',
  },
  metaRow: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 6,
  },
  metaItem: {
    fontSize: 8,
    color: '#6b7280',
  },
  metaValue: {
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  filterBox: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 3,
    padding: 7,
    marginBottom: 14,
  },
  filterTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    marginBottom: 3,
  },
  filterText: {
    fontSize: 8,
    color: '#6b7280',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 3,
    padding: 7,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  summaryLabel: {
    fontSize: 7,
    color: '#6b7280',
    marginTop: 2,
  },
  table: {
    width: '100%',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingVertical: 4,
    paddingHorizontal: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  thText: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
  },
  tdText: {
    fontSize: 7,
    color: '#374151',
  },
  monoText: {
    fontFamily: 'Courier',
    fontSize: 7,
  },
  colHost: { flex: 2 },
  colOs: { flex: 2.5 },
  colVersion: { flex: 2 },
  colSource: { flex: 0.8 },
  colArch: { flex: 1 },
  colFirstSeen: { flex: 1.2 },
  colLastSeen: { flex: 1.2 },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 32,
    right: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 5,
  },
  footerText: {
    fontSize: 7,
    color: '#9ca3af',
  },
})

export interface HostExportRow {
  name: string
  hostname: string
  displayName: string | null
  os: string | null
  osVersion: string | null
  version: string
  source: string
  architecture: string | null
  firstSeenAt: Date
  lastSeenAt: Date
}

interface VersionFilter {
  mode: 'exact' | 'prefix' | 'between'
  exact?: string
  prefix?: string
  low?: string
  high?: string
}

interface Props {
  orgName: string
  packageName: string
  versionFilter?: VersionFilter
  osFamily?: string
  rows: HostExportRow[]
  generatedAt: Date
}

function filterSummary(packageName: string, versionFilter?: VersionFilter, osFamily?: string): string {
  const parts: string[] = []
  parts.push(`Package: ${packageName}`)
  if (versionFilter) {
    if (versionFilter.mode === 'exact' && versionFilter.exact) parts.push(`Version: ${versionFilter.exact}`)
    else if (versionFilter.mode === 'prefix' && versionFilter.prefix) parts.push(`Version starts with: ${versionFilter.prefix}`)
    else if (versionFilter.mode === 'between' && versionFilter.low && versionFilter.high)
      parts.push(`Version between: ${versionFilter.low} – ${versionFilter.high}`)
  }
  if (osFamily) parts.push(`OS: ${osFamily}`)
  return parts.join(' | ')
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function SoftwareReportPDF({
  orgName,
  packageName,
  versionFilter,
  osFamily,
  rows,
  generatedAt,
}: Props) {
  const uniqueHosts = new Set(rows.map((r) => r.displayName ?? r.hostname)).size
  const uniqueVersions = new Set(rows.map((r) => r.version)).size

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Installed Software Report</Text>
          <Text style={styles.subtitle}>{orgName}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaItem}>
              Generated: <Text style={styles.metaValue}>{generatedAt.toLocaleString()}</Text>
            </Text>
          </View>
        </View>

        {/* Summary cards */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryNumber}>{rows.length.toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>Results</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryNumber}>{uniqueHosts.toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>Hosts</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryNumber}>{uniqueVersions.toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>Versions</Text>
          </View>
        </View>

        {/* Filters */}
        <View style={styles.filterBox}>
          <Text style={styles.filterTitle}>Applied filters</Text>
          <Text style={styles.filterText}>{filterSummary(packageName, versionFilter, osFamily)}</Text>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.thText, styles.colHost]}>Host</Text>
            <Text style={[styles.thText, styles.colOs]}>OS</Text>
            <Text style={[styles.thText, styles.colVersion]}>Version</Text>
            <Text style={[styles.thText, styles.colSource]}>Source</Text>
            <Text style={[styles.thText, styles.colArch]}>Architecture</Text>
            <Text style={[styles.thText, styles.colFirstSeen]}>First seen</Text>
            <Text style={[styles.thText, styles.colLastSeen]}>Last seen</Text>
          </View>
          {rows.map((row, i) => (
            <View key={i} style={styles.tableRow} wrap={false}>
              <Text style={[styles.tdText, styles.colHost]}>{row.displayName ?? row.hostname}</Text>
              <Text style={[styles.tdText, styles.colOs]}>{row.osVersion ?? row.os ?? '—'}</Text>
              <Text style={[styles.monoText, styles.colVersion]}>{row.version}</Text>
              <Text style={[styles.tdText, styles.colSource]}>{row.source}</Text>
              <Text style={[styles.tdText, styles.colArch]}>{row.architecture ?? '—'}</Text>
              <Text style={[styles.tdText, styles.colFirstSeen]}>{fmtDate(row.firstSeenAt)}</Text>
              <Text style={[styles.tdText, styles.colLastSeen]}>{fmtDate(row.lastSeenAt)}</Text>
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {orgName} — Installed Software Report — {generatedAt.toLocaleDateString()}
          </Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          } />
        </View>
      </Page>
    </Document>
  )
}
