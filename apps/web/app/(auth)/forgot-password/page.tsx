import type { Metadata } from 'next'
import { ForgotPasswordForm } from './reset-request-form'

export const metadata: Metadata = {
  title: 'Forgot password',
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />
}
