import { Badge } from '@/components/ui/badge'
import type { CertificateStatus } from '@/lib/db/schema'

export function CertificateStatusBadge({ status }: { status: CertificateStatus }) {
  switch (status) {
    case 'valid':
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
          Valid
        </Badge>
      )
    case 'expiring_soon':
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
          Expiring Soon
        </Badge>
      )
    case 'expired':
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
          Expired
        </Badge>
      )
    case 'invalid':
      return (
        <Badge className="bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/10">
          Invalid
        </Badge>
      )
  }
}
