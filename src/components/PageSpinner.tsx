/**
 * The one full-page wait. `ProtectedRoute` shows it while the session resolves,
 * `RoleGuard` while the capability set loads, and App while a route chunk
 * arrives — from the user's side all three are "the page is coming", and two
 * different waits would read as two different kinds of slow.
 */
export function PageSpinner() {
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="mt-2 text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

export default PageSpinner;
