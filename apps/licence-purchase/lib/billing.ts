export type BillingInterval = 'month' | 'year'

export function formatPrice(unitAmount: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: unitAmount % 100 === 0 ? 0 : 2,
  }).format(unitAmount / 100)
}
