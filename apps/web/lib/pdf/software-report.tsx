import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer'
import type { SoftwareReportRow, SoftwareReportFilters } from '@/lib/actions/software-inventory'

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    padding: 36,
    color: '#111827',
  },
  header: {
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingBottom: 12,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 10,
    color: '#6b7280',
  },
  metaRow: {
    flexDirection: 'row',
    gap: 24,
    marginTop: 8,
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
    borderRadius: 4,
    padding: 8,
    marginBottom: 16,
  },
  filterTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    marginBottom: 4,
  },
  filterText: {
    fontSize: 8,
    color: '#6b7280',
  },
  table: {
    width: '100%',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  colName: { flex: 3, fontFamily: 'Helvetica-Bold' },
  colVersion: { flex: 2 },
  colHosts: { flex: 1, textAlign: 'right' },
  colSources: { flex: 1.5 },
  colHostList: { flex: 4 },
  thText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
  },
  tdText: {
    fontSize: 8,
    color: '#374151',
  },
  monoText: {
    fontFamily: 'Courier',
    fontSize: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 6,
  },
  footerText: {
    fontSize: 7,
    color: '#9ca3af',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 4,
    padding: 8,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  summaryLabel: {
    fontSize: 7,
    color: '#6b7280',
    marginTop: 2,
  },
})

interface Props {
  orgName: string
  filters: SoftwareReportFilters
  rows: SoftwareReportRow[]
  total: number
  uniquePackages: number
  hostsWithData: number
  generatedAt: Date
}

function filterSummary(filters: SoftwareReportFilters): string {
  const parts: string[] = []
  if (filters.name) parts.push(`Package: ${filters.name}`)
  if (filters.versionMode && filters.versionMode !== 'any') {
    if (filters.versionMode === 'exact') parts.push(`Version: ${filters.versionExact}`)
    else if (filters.versionMode === 'prefix') parts.push(`Version starts with: ${filters.versionPrefix}`)
    else if (filters.versionMode === 'between')
      parts.push(`Version between: ${filters.versionLow} – ${filters.versionHigh}`)
  }
  if (filters.source) parts.push(`Source: ${filters.source}`)
  return parts.length > 0 ? parts.join(' | ') : 'All packages'
}

export function SoftwareReportPDF({
  orgName,
  filters,
  rows,
  total,
  uniquePackages,
  hostsWithData,
  generatedAt,
}: Props) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
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
            <Text style={styles.summaryNumber}>{total.toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>Results</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryNumber}>{uniquePackages.toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>Unique packages</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryNumber}>{hostsWithData.toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>Hosts with data</Text>
          </View>
        </View>

        {/* Filters */}
        <View style={styles.filterBox}>
          <Text style={styles.filterTitle}>Applied filters</Text>
          <Text style={styles.filterText}>{filterSummary(filters)}</Text>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.thText, styles.colName]}>Package</Text>
            <Text style={[styles.thText, styles.colVersion]}>Version</Text>
            <Text style={[styles.thText, styles.colHosts]}>Hosts</Text>
            <Text style={[styles.thText, styles.colSources]}>Source</Text>
            <Text style={[styles.thText, styles.colHostList]}>Hosts</Text>
          </View>
          {rows.map((row, i) => (
            <View key={i} style={styles.tableRow} wrap={false}>
              <Text style={[styles.monoText, styles.colName]}>{row.name}</Text>
              <Text style={[styles.monoText, styles.colVersion]}>{row.version}</Text>
              <Text style={[styles.tdText, styles.colHosts]}>{row.hostCount}</Text>
              <Text style={[styles.tdText, styles.colSources]}>{row.sources.join(', ')}</Text>
              <Text style={[styles.tdText, styles.colHostList]}>
                {row.hostNames.slice(0, 5).join(', ')}
                {row.hostNames.length > 5 ? ` +${row.hostNames.length - 5} more` : ''}
              </Text>
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
