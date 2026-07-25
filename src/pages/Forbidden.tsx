import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCapabilities } from '@/hooks/useCapabilities';

const Forbidden = () => {
  const { user } = useAuth();
  const { homePath } = useCapabilities();
  // Signed in: the first page they may actually open. A plain `/` would bounce
  // through the landing page straight back to the page that denied them.
  const backTo = user ? homePath : '/';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto h-14 w-14 rounded-full bg-muted flex items-center justify-center">
          <ShieldAlert className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Access restricted</h1>
          <p className="text-sm text-muted-foreground">
            You don't have permission to view this page. If you believe this is a mistake,
            contact your administrator.
          </p>
        </div>
        <Button asChild>
          <Link to={backTo} replace>Return to home</Link>
        </Button>
      </div>
    </div>
  );
};

export default Forbidden;
