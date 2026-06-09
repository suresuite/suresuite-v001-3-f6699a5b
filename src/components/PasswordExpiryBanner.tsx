import { useAuth } from '@/hooks/useAuth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Shows a warning banner when the user's password expires within 14 days. */
const PasswordExpiryBanner = () => {
  const { user } = useAuth();
  if (!user?.password_expires_at) return null;

  const expires = new Date(user.password_expires_at);
  const daysLeft = Math.ceil((expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft > 14) return null;

  const expired = daysLeft <= 0;

  return (
    <Alert
      variant={expired ? 'destructive' : 'default'}
      className="mt-3 mb-3"
    >
      <KeyRound className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>
          {expired
            ? 'Your password has expired. Please update it to continue working securely.'
            : `Your password will expire in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`}
        </span>
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