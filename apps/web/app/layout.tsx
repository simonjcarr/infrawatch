import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QueryProvider } from '@/components/shared/query-provider'
import '@mdxeditor/editor/style.css'
import './globals.css'

const geistSans = Geist({
  variable: '--font-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    default: 'CT-Ops',
    template: '%s | CT-Ops',
  },
  description: 'Open-source infrastructure monitoring and tooling platform',
}

// Inline script applied before React hydrates to prevent flash of wrong theme.
// Reads the `theme` cookie and adds the `dark` class if needed.
const themeInitScript = `(function(){try{var t=document.cookie.match(/(?:^|; )theme=([^;]*)/)?.[1];if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const cookieStore = await cookies()
  const theme = cookieStore.get('theme')?.value ?? 'system'
  const isDark = theme === 'dark'

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full${isDark ? ' dark' : ''}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full antialiased">
        <QueryProvider>
          <TooltipProvider>
            {children}
          </TooltipProvider>
        </QueryProvider>
      </body>
    </html>
  )
}
