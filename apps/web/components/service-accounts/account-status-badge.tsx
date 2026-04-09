import { Badge } from '@/components/ui/badge'
import type { ServiceAccountStatus } from '@/lib/db/schema'

export function AccountStatusBadge({ status }: { status: ServiceAccountStatus }) {
  switch (status) {
    case 'active':
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
          Active
        </Badge>
      )
    case 'missing':
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200 hover:bg-red-100">
          Missing
        </Badge>
      )
    case 'disabled':
      return (
        <Badge className="bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-100">
          Disabled
        </Badge>
      )
  }
}
