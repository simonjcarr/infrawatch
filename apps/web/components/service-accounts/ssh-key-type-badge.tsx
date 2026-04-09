import { Badge } from '@/components/ui/badge'
import type { SshKeyType } from '@/lib/db/schema'

const labels: Record<SshKeyType, string> = {
  rsa: 'RSA',
  ed25519: 'Ed25519',
  ecdsa: 'ECDSA',
  dsa: 'DSA',
  unknown: 'Unknown',
}

export function SshKeyTypeBadge({ type }: { type: SshKeyType }) {
  const label = labels[type] ?? type

  if (type === 'ed25519') {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
        {label}
      </Badge>
    )
  }
  if (type === 'rsa') {
    return (
      <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100">
        {label}
      </Badge>
    )
  }
  if (type === 'ecdsa') {
    return (
      <Badge className="bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100">
        {label}
      </Badge>
    )
  }
  return (
    <Badge className="bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-100">
      {label}
    </Badge>
  )
}
