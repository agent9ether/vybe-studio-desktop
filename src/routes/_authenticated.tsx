import { createFileRoute, Outlet } from "@tanstack/react-router";

// Kept as a pathless layout so route ids match the hosted app.
// The desktop app is single-user, so there is nothing to guard.
export const Route = createFileRoute("/_authenticated")({
  component: Outlet,
});
