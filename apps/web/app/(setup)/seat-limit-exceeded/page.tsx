import type { Metadata } from 'next'
import { SeatLimitExceededCard } from './seat-limit-exceeded-card'

export const metadata: Metadata = {
  title: 'Seat limit exceeded',
}

export default function SeatLimitExceededPage() {
  return <SeatLimitExceededCard />
}
