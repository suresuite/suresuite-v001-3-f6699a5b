import { useAuth } from '@/hooks/useAuth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EXPIRY_WARNING_DAYS, describeExpiry, passwordStatus, shouldWarn } from '@/lib/auth/passwordPolicy';

/**
 * Warns when the password expires within `EXPIRY_WARNING_DAYS` calendar days. Once a
 * change is REQUIRED it stays silent: `RoleGuard` has already sent the user to
 * /profile, and that page says so itself (PLAN.md §4 D206).
 */
const PasswordExpiryBanner = () => {
  const { user } = useAuth();
  const status = passwordStatus(user);
  if (!shouldWarn(status)) return null;

  return (
    <Alert className="mt-3 mb-3">
      <KeyRound className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between gap-3">
        <span title={`Shown from ${EXPIRY_WARNING_DAYS} days before expiry`}>{describeExpiry(status)}</span>
        <Link
          to="/profile?tab=password"
          className="font-medium underline underline-offset-2 hover:no-underline"
        >
          Change password
        </Link>
      </AlertDescription>
    </Alert>
  );
};

export default PasswordExpiryBanner;
