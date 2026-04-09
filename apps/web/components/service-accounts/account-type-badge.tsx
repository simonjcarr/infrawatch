import { Badge } from '@/components/ui/badge'
import type { ServiceAccountType } from '@/lib/db/schema'

export function AccountTypeBadge({ type }: { type: ServiceAccountType }) {
  switch (type) {
    case 'human':
      return (
        <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">
          Human
        </Badge>
      )
    case 'service':
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
          Service
        </Badge>
      )
    case 'system':
      return (
        <Badge className="bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-100">
          System
        </Badge>
      )
  }
}
