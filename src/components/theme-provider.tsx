'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ComponentProps } from 'react'

/**
 * Client wrapper around next-themes so the root layout can stay a server
 * component. Class-based theming (`.dark` on <html>), defaulting to light so
 * existing users see zero change; OS preference is offered via the toggle
 * ("system") but never auto-applied to first-time visitors.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
