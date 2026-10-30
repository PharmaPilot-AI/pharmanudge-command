import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/ask-ai")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
