import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Compass } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCapabilities } from '@/hooks/useCapabilities';

const NotFound = () => {
  const { user } = useAuth();
  const { homePath } = useCapabilities();
  const { pathname } = useLocation();
  // Same reasoning as Forbidden: signed-in users go to the first page they may
  // actually open, everyone else to the landing page.
  const backTo = user ? homePath : '/';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto h-14 w-14 rounded-full bg-muted flex items-center justify-center">
          <Compass className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            We couldn't find anything at <span className="font-mono">{pathname}</span>. The link
            may be out of date, or the page may have moved.
          </p>
        </div>
        <Button asChild>
          <Link to={backTo} replace>Return to home</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
