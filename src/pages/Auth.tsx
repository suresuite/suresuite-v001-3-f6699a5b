import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useToast } from '@/hooks/use-toast';
import { Mail, Lock, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import Footer from '@/components/Footer';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { homePath } = useCapabilities();
  const { toast } = useToast();

  // Where to land once authenticated: the page they were sent here from, or the
  // first app page they may open. Never `/` — that is the public landing page,
  // which would only bounce onward through an extra redirect.
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const redirectTo = from && !from.startsWith('/auth') ? from : homePath;

  // Single redirect owner: fires both for a fresh login and for an already
  // authenticated user who lands on /auth. `replace` keeps the login screen out
  // of history, so Back from the app doesn't return to it.
  useEffect(() => {
    if (user) {
      navigate(redirectTo, { replace: true });
    }
  }, [user, navigate, redirectTo]);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    console.log('[AUTH-PAGE] Starting login submission');
    setIsLoading(true);
    
    const result = await login(data.email, data.password);
    
    console.log('[AUTH-PAGE] Login result:', result);
    
    if (result.success) {
      toast({
        title: 'Login successful',
        description: 'Welcome back!',
      });
      // The redirect is owned by the effect above, which fires as soon as the
      // auth context has a user — navigating here too would push a duplicate
      // history entry.
      console.log('[AUTH-PAGE] Authenticated, redirecting to', redirectTo);
    } else {
      toast({
        title: 'Login failed',
        description: result.error || 'Please check your credentials and try again.',
        variant: 'destructive',
      });
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold text-center">Welcome Back</CardTitle>
              <CardDescription className="text-center">
                Enter your credentials to access the app
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="login" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login">Login</TabsTrigger>
                  <TabsTrigger value="register">Register</TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="space-y-4">
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Username</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                <Input
                                  {...field}
                                  type="email"
                                  placeholder="Enter your username"
                                  className="pl-10"
                                  disabled={isLoading}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Password</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                <Input
                                  {...field}
                                  type={showPassword ? "text" : "password"}
                                  placeholder="Enter your password"
                                  className="pl-10 pr-10"
                                  disabled={isLoading}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                  onClick={() => setShowPassword(!showPassword)}
                                  disabled={isLoading}
                                >
                                  {showPassword ? (
                                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                                  ) : (
                                    <Eye className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </Button>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Button type="submit" className="w-full" disabled={isLoading}>
                        {isLoading ? 'Logging in...' : 'Log In'}
                      </Button>
                    </form>
                  </Form>
                </TabsContent>

                <TabsContent value="register" className="space-y-4">
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Account Registration</strong>
                      <br />
                      To request access to this application, please send an email to{' '}
                      <a
                        href="mailto:phu.nguyen@hwr-berlin.de"
                        className="text-primary hover:underline font-medium"
                      >
                        phu.nguyen@hwr-berlin.de
                      </a>
                      {' '}with your request for an account.
                    </AlertDescription>
                  </Alert>

                  <div className="text-center pt-4">
                    <p className="text-sm text-muted-foreground">
                      Already have an approved account?{' '}
                      <Button
                        variant="link"
                        className="p-0 h-auto font-normal"
                        onClick={() => form.reset()}
                      >
                        Log in here
                      </Button>
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
      <Footer hasNavBar={false} />
    </div>
  );
};

export default Auth;
