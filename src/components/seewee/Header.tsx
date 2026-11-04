'use client'

import { useState, useSyncExternalStore } from 'react'
import Image from 'next/image'
import { useTheme } from 'next-themes'
import { useAppStore, type View } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { JobAlertsBell } from '@/components/seewee/JobAlertsBell'
import { NotificationBell } from '@/components/seewee/NotificationBell'
import { toast } from 'sonner'
import {
  Bot,
  BriefcaseBusiness,
  Eye,
  FileText,
  Handshake,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Search,
  Send,
  ShieldCheck,
  Sun,
  UserRound,
  UsersRound,
} from 'lucide-react'

export function SeeWeLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Image
        src="/seewee-logo.png"
        alt="SeeWe — AI Hiring Suite"
        width={200}
        height={110}
        priority
        className="h-11 w-auto rounded-lg shadow-sm ring-1 ring-slate-900/10 dark:ring-white/15"
      />
      {!compact && (
        <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500 sm:block">
          AI Hiring
          <br />
          Suite
        </span>
      )}
    </div>
  )
}

/** Animated sun/moon swap, driven purely by the `.dark` class on <html> (set
 * pre-paint by next-themes' injected script → zero icon flash, and no
 * hydration mismatch because the markup is identical on server and client).
 * `mounted` comes from useSyncExternalStore (not setState-in-effect) only to
 * put the current mode into the tooltip after hydration. */
const noopSubscribe = () => () => {}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )
  const isDark = mounted && resolvedTheme === 'dark'
  const title = !mounted
    ? 'Toggle theme'
    : isDark
      ? 'Dark mode is on — switch to light'
      : 'Light mode is on — switch to dark'

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label="Toggle dark mode"
      title={title}
      className="relative flex h-11 w-11 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
    >
      <Sun
        aria-hidden
        className="h-5 w-5 -rotate-90 scale-0 transition-all duration-300 dark:rotate-0 dark:scale-100"
      />
      <Moon
        aria-hidden
        className="absolute h-5 w-5 rotate-0 scale-100 transition-all duration-300 dark:rotate-90 dark:scale-0"
      />
    </button>
  )
}

const CANDIDATE_NAV: { view: View; label: string; icon: typeof Eye }[] = [
  { view: 'home', label: 'Home', icon: LayoutDashboard },
  { view: 'browse', label: 'Find Jobs', icon: BriefcaseBusiness },
  { view: 'candidate', label: 'My Journey', icon: FileText },
]

// Recruiters POST jobs — they never hunt for one, so no "Find Jobs" here.
// Talent Search is promoted to a top-level tab (next to Hiring Hub) — an
// resume-database hunting deserves its own surface, not a buried tab.
const RECRUITER_NAV: { view: View; label: string; icon: typeof Eye }[] = [
  { view: 'home', label: 'Home', icon: LayoutDashboard },
  { view: 'recruiter', label: 'Hiring Hub', icon: UsersRound },
  { view: 'talent', label: 'Talent Search', icon: Search },
]

// The platform console is admin-only territory — candidates and recruiters
// get ZERO admin surfaces in their navigation (the dedicated Admin button
// appears for admins only).
const ADMIN_NAV: { view: View; label: string; icon: typeof Eye }[] = []

// Client partners review reports/talent — job hunting is a candidate journey.
const CLIENT_NAV: { view: View; label: string; icon: typeof Eye }[] = [
  { view: 'home', label: 'Home', icon: LayoutDashboard },
  { view: 'client', label: 'Client Portal', icon: Handshake },
]

function NavButton({
  item,
  active,
  onClick,
}: {
  item: { view: View; label: string; icon: typeof Eye }
  active: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        active
          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {item.label}
    </button>
  )
}

export function Header() {
  const user = useAppStore((s) => s.user)
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const logout = useAppStore((s) => s.logout)
  const [mobileOpen, setMobileOpen] = useState(false)

  const nav =
    user?.role === 'RECRUITER'
      ? RECRUITER_NAV
      : user?.role === 'CLIENT'
        ? CLIENT_NAV
        : user?.role === 'ADMIN'
          ? ADMIN_NAV
          : user
            ? CANDIDATE_NAV
            : CANDIDATE_NAV.slice(0, 2)

  function go(v: View) {
    if (v === 'candidate' && (!user || user.role !== 'CANDIDATE')) {
      if (!user) {
        setAuthOpen(true)
        return
      }
      if (user.role === 'RECRUITER') {
        toast.info("You're signed in as a recruiter — that's the Hiring Hub 👈")
        setView('recruiter')
        return
      }
      if (user.role === 'CLIENT') {
        toast.info('Client partners review talent from the Client Portal 🤝')
        setView('client')
        return
      }
    }
    if (v === 'recruiter' && (!user || user.role !== 'RECRUITER')) {
      if (!user) {
        setAuthOpen(true)
        return
      }
      toast.info('Switch to a recruiter account to access the Hiring Hub 🔐')
      setAuthOpen(true)
      return
    }
    if (v === 'talent' && (!user || user.role !== 'RECRUITER')) {
      if (!user) {
        setAuthOpen(true)
        return
      }
      toast.info('Talent Search is a recruiter superpower — switch to a recruiter account 🔍')
      setAuthOpen(true)
      return
    }
    if (v === 'client' && (!user || user.role !== 'CLIENT')) {
      if (!user) {
        setAuthOpen(true)
        return
      }
      toast.info('The Client Portal is for client partners — sign in with your registered client email 🤝')
      setAuthOpen(true)
      return
    }
    setView(v)
    setMobileOpen(false)
  }

  const isActive = (v: View) => {
    if (view === v) return true
    // reports live inside the Hiring Hub dashboard
    if (view === 'reports' && v === 'recruiter') return true
    // Talent Search is its own standalone module — it activates its own nav item
    // (handled by the `view === v` check above), never the Hiring Hub one.
    return false
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/80">
      <a href="#main" className="sr-only focus:not-sr-only">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => setView('home')}
          className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="SeeWe home"
        >
          <SeeWeLogo />
        </button>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {nav.map((item) => (
            <NavButton key={item.view} item={item} active={isActive(item.view)} onClick={() => go(item.view)} />
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {user?.role === 'ADMIN' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setView('admin')}
              title="Admin console"
              className="hidden h-10 border-blue-200 bg-white/60 px-4 text-blue-700 hover:bg-blue-50 hover:text-blue-800 md:inline-flex dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-950/60 dark:hover:text-blue-200"
            >
              <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden /> Admin
            </Button>
          )}
          {user && <NotificationBell key={user.id} />}
          {user?.role === 'CANDIDATE' && <JobAlertsBell />}
          <ThemeToggle />
          {!user ? (
            <Button
              onClick={() => setAuthOpen(true)}
              size="sm"
              className="hidden h-10 bg-gradient-to-r from-blue-600 to-sky-600 px-5 text-white shadow-md hover:from-blue-700 hover:to-sky-700 sm:inline-flex"
            >
              <UserRound className="mr-1.5 h-4 w-4" aria-hidden /> Sign in
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Account menu"
                  className="flex items-center gap-2 rounded-full p-1 pr-2 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-800"
                >
                  <Avatar className="h-8 w-8 border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
                    <AvatarFallback className="bg-blue-100 text-xs font-bold text-blue-700 dark:bg-blue-900/70 dark:text-blue-300">
                      {user.name
                        .split(' ')
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-[120px] truncate text-sm font-medium text-slate-700 dark:text-slate-200 lg:block">
                    {user.name.split(' ')[0]}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl">
                <DropdownMenuLabel>
                  <p className="text-sm font-semibold">{user.name}</p>
                  <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
                  <p className="mt-1 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
                    {user.role === 'RECRUITER'
                      ? '🏢 Recruiter'
                      : user.role === 'CLIENT'
                        ? '🤝 Client Partner'
                        : user.role === 'ADMIN'
                          ? '🛡️ Platform Admin'
                          : '🎯 Job Seeker'}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    go(
                      user.role === 'RECRUITER'
                        ? 'recruiter'
                        : user.role === 'CLIENT'
                          ? 'client'
                          : 'candidate'
                    )
                  }
                >
                  {user.role === 'RECRUITER' ? (
                    <UsersRound className="mr-2 h-4 w-4" />
                  ) : user.role === 'CLIENT' ? (
                    <Handshake className="mr-2 h-4 w-4" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" />
                  )}
                  {user.role === 'CLIENT' ? 'Client Portal' : 'Dashboard'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    void navigator.clipboard?.writeText(user.email).catch(() => {})
                    toast.success('Email copied')
                  }}
                >
                  <Send className="mr-2 h-4 w-4" /> Copy email
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {user.role === 'ADMIN' && (
                  <DropdownMenuItem onClick={() => setView('admin')}>
                    <ShieldCheck className="mr-2 h-4 w-4" /> Admin console
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    logout()
                    toast('Signed out — see you soon! 👋')
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Mobile menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetTitle className="sr-only">Navigation menu</SheetTitle>
              <div className="mb-6 mt-2">
                <SeeWeLogo />
              </div>
              <nav className="flex flex-col gap-1" aria-label="Mobile">
                {(user?.role === 'RECRUITER'
                  ? RECRUITER_NAV
                  : user?.role === 'CLIENT'
                    ? CLIENT_NAV
                    : user?.role === 'ADMIN'
                      ? ADMIN_NAV
                      : [...CANDIDATE_NAV]
                ).map((item) => (
                  <NavButton
                    key={item.view}
                    item={item}
                    active={isActive(item.view)}
                    onClick={() => go(item.view)}
                  />
                ))}
                {user?.role === 'ADMIN' && (
                  <NavButton
                    item={{ view: 'admin', label: 'Admin console', icon: ShieldCheck }}
                    active={isActive('admin')}
                    onClick={() => {
                      setView('admin')
                      setMobileOpen(false)
                    }}
                  />
                )}
              </nav>
              {!user && (
                <Button
                  className="mt-6 h-11 w-full bg-gradient-to-r from-blue-600 to-sky-600 text-white"
                  onClick={() => {
                    setMobileOpen(false)
                    setAuthOpen(true)
                  }}
                >
                  Sign in / Register
                </Button>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
