import { useEffect, useState, type ComponentPropsWithoutRef } from "react";

type CredentialFormProps = Omit<ComponentPropsWithoutRef<"form">, "method" | "action">;

/** Credential entry requires the hydrated submit handler; native fallback never uses GET. */
export function CredentialForm({ children, ...props }: CredentialFormProps) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <form {...props} method="post">
      <fieldset disabled={!hydrated} className="contents">
        {children}
      </fieldset>
      <noscript>
        <p role="alert">Enable JavaScript to securely submit this form.</p>
      </noscript>
    </form>
  );
}
