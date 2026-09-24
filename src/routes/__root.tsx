import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  redirect,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppShell } from "@/components/layout/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { AppModeProvider } from "@/lib/app-mode";
import { resolveSessionUser } from "@/lib/auth/context";
import { isAllowedRedirect } from "@/lib/auth/redirect";
import { getPharmacyContext, type PharmacyContext } from "@/lib/pharmacy-context";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

interface AuthRouteContext {
  user: { userId: string; email: string | undefined } | null;
  pharmacyContext: PharmacyContext | null;
}

/**
 * Routes reachable without an authenticated session, and rendered without
 * AppShell chrome (Checkpoint 6B: /forgot-password and /reset-password join
 * /login here — the recovery flow must be reachable and presentable to a
 * signed-out visitor same as login itself).
 */
const PUBLIC_ROUTE_PATHS = ["/login", "/forgot-password", "/reset-password"] as const;

function isPublicRoute(pathname: string): boolean {
  return (PUBLIC_ROUTE_PATHS as readonly string[]).includes(pathname);
}

/**
 * Resolves the authenticated session (refreshing it if needed) and, when
 * present, the caller's pharmacy membership/role — in one server-only call.
 * Wrapped in createServerFn rather than called directly from beforeLoad,
 * since beforeLoad is isomorphic (it can run client-side on subsequent
 * navigations) while session/token resolution must never run in the
 * browser; createServerFn guarantees server-only execution regardless of
 * caller environment, matching this codebase's existing route-loader
 * pattern (e.g. src/routes/products.tsx's getProducts).
 *
 * This is the only place in the app that calls getPharmacyContext() for
 * presentation/routing purposes — called at most once per beforeLoad
 * invocation.
 */
const resolveAuthContext = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthRouteContext> => {
    const resolved = await resolveSessionUser();
    if (!resolved) return { user: null, pharmacyContext: null };

    const client = createServerSupabaseClient(resolved.accessToken);
    const pharmacyContext = await getPharmacyContext(client);

    return {
      user: { userId: resolved.userId, email: resolved.email },
      pharmacyContext,
    };
  },
);

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ location }): Promise<AuthRouteContext> => {
    const { user, pharmacyContext } = await resolveAuthContext();

    if (!user && !isPublicRoute(location.pathname)) {
      throw redirect({
        // "/login" doesn't exist as a registered route until Checkpoint 6
        // creates src/routes/login.tsx, so TanStack Router's route-tree-
        // derived `to`/`search` typing can't yet verify this call. Both
        // casts become redundant (but harmless) once that route exists;
        // safe now because redirect()'s runtime behavior never depends on
        // this compile-time route-tree check.
        to: "/login" as any,
        search: {
          redirect: isAllowedRedirect(location.pathname) ? location.pathname : undefined,
        } as any,
      });
    }

    if (user && !pharmacyContext && !isPublicRoute(location.pathname)) {
      throw redirect({ to: "/login" });
    }

    return { user, pharmacyContext };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "PharmaNudge" },
      {
        name: "description",
        content:
          "Pharmacy business management and decision intelligence for independent pharmacies in Nigeria.",
      },
      { property: "og:title", content: "PharmaNudge" },
      {
        property: "og:description",
        content:
          "Pharmacy business management and decision intelligence for independent pharmacies in Nigeria.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Public routes must never render inside the authenticated AppShell
  // chrome (header identity, sidebar/bottom nav, logout button) — these are
  // the routes reachable while unauthenticated.
  return (
    <QueryClientProvider client={queryClient}>
      <AppModeProvider>
        {isPublicRoute(pathname) ? (
          <Outlet />
        ) : (
          <AppShell>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
          </AppShell>
        )}
        <Toaster position="top-center" richColors />
      </AppModeProvider>
    </QueryClientProvider>
  );
}
