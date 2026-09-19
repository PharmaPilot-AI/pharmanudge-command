import { Link } from "@tanstack/react-router";
import { Cross, LayoutGrid, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAppMode } from "@/lib/app-mode";
import { opsMobilePrimaryPaths, opsNav, ownerNav, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { LogoutButton } from "./LogoutButton";
import { ModeSwitcher } from "./ModeSwitcher";
import { SyncStatusPill } from "./SyncStatusPill";

/**
 * Application shell. Viewport only changes layout: bottom nav on mobile,
 * labeled sidebar on desktop. The nav contents come from the user's mode.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { mode } = useAppMode();
  const [menuOpen, setMenuOpen] = useState(false);

  const items = mode === "owner" ? ownerNav : opsNav;
  const mobilePrimary =
    mode === "owner"
      ? ownerNav
      : opsNav.filter((i) => opsMobilePrimaryPaths.includes(i.to as string));

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Cross className="h-4.5 w-4.5" aria-hidden />
            </span>
            <span className="truncate text-base font-bold tracking-tight">
              Pharma<span className="text-primary">Nudge</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <SyncStatusPill />
            <ModeSwitcher />
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl items-start">
        {/* Desktop/tablet sidebar — driven by mode, not viewport */}
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r px-3 py-4 lg:block">
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {mode === "owner" ? "Owner" : "Operations"}
          </p>
          <nav className="flex flex-col gap-0.5" aria-label="Primary">
            {items.map((item) => (
              <SidebarLink key={item.to as string} item={item} />
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-4 pb-28 pt-4 sm:px-6 lg:pb-12 lg:pt-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur lg:hidden"
        aria-label="Primary"
      >
        <div
          className="mx-auto grid max-w-lg"
          style={{ gridTemplateColumns: `repeat(${mobilePrimary.length + (mode === "ops" ? 1 : 0)}, minmax(0, 1fr))` }}
        >
          {mobilePrimary.map((item) => (
            <BottomNavLink key={item.to as string} item={item} />
          ))}
          {mode === "ops" && (
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <LayoutGrid className="h-5 w-5" aria-hidden />
              <span className="text-[10px] font-medium">Menu</span>
            </button>
          )}
        </div>
      </nav>

      {/* Mobile ops menu overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" role="dialog" aria-modal="true" aria-label="All operations screens">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="relative rounded-t-2xl border-t bg-card p-4 pb-8 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">All operations</h2>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {opsNav.map((item) => (
                <Link
                  key={item.to as string}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border bg-background px-2 py-3 text-center transition-colors hover:bg-muted"
                >
                  <item.icon className="h-5 w-5 text-primary" aria-hidden />
                  <span className="text-[11px] font-medium leading-tight">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === "/" }}
      className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      activeProps={{ className: "bg-secondary text-secondary-foreground hover:bg-secondary hover:text-secondary-foreground" }}
    >
      <item.icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
      {item.label}
    </Link>
  );
}

function BottomNavLink({ item }: { item: NavItem }) {
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === "/" }}
      className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-muted-foreground transition-colors hover:text-foreground"
      activeProps={{ className: "text-primary hover:text-primary" }}
    >
      <item.icon className="h-5 w-5" aria-hidden />
      <span className="text-[10px] font-medium">{item.label}</span>
    </Link>
  );
}
