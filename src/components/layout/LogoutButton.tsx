import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/auth/actions";

/**
 * Fail-safe: navigates to /login regardless of logoutAction's outcome.
 * logoutAction's own cookie clear is already unconditional, so even a
 * network/server error here must still send the user to the login screen.
 */
export function LogoutButton() {
  const navigate = useNavigate();
  const logout = useServerFn(logoutAction);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Ignore — logoutAction already clears the cookie unconditionally.
    } finally {
      await navigate({ to: "/login", search: { redirect: undefined } });
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      aria-label="Log out"
      onClick={() => void handleLogout()}
    >
      <LogOut className="h-4 w-4" aria-hidden />
    </Button>
  );
}
