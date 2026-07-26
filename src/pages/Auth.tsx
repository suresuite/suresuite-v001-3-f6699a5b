import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useToast } from '@/hooks/use-toast';
import { Check } from 'lucide-react';
import AuthHeroStrip from '@/components/AuthHeroStrip';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { homePath } = useCapabilities();
  const { toast } = useToast();

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const redirectTo = from && !from.startsWith('/auth') ? from : homePath;

  useEffect(() => {
    if (user) {
      navigate(redirectTo, { replace: true });
    }
  }, [user, navigate, redirectTo]);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setFormError(null);

    const result = await login(data.email, data.password);

    if (result.success) {
      // Redirect is owned by the effect above; this only covers the hand-off beat.
      setSignedIn(true);
      toast({ title: 'Login successful', description: 'Welcome back!' });
    } else {
      // Inline error is the primary channel now — the toast is the backstop.
      setFormError(result.error || 'Those credentials don’t match an approved account.');
      toast({
        title: 'Login failed',
        description: result.error || 'Please check your credentials and try again.',
        variant: 'destructive',
      });
    }

    setIsLoading(false);
  };

  const isBusy = isLoading || signedIn;

  return (
    <div className="flex min-h-screen items-stretch bg-white text-[#171717]">
      {/* Form column */}
      <div className="flex shrink-0 grow-0 basis-[clamp(420px,44%,600px)] flex-col justify-start border-r border-[#ebebeb] px-[clamp(32px,5vw,76px)] pb-8 pt-9">
        <img
          src="/logo-lockup.png"
          alt="SuReSuite — Supply Chain Resilience Suite"
          className="h-10 w-auto self-start object-contain"
        />

        <div className="my-auto flex w-full max-w-[400px] flex-col gap-[22px] py-7">
          <h1 className="m-0 text-[31px] font-semibold leading-[1.1] tracking-[-0.022em]">
            Welcome <span className="font-serif italic font-medium">back.</span>
          </h1>

          {formError && (
            <div className="flex items-start gap-[11px] rounded border border-[#f3c9cd] bg-[#fdf5f5] px-[14px] py-[13px]">
              <span className="mt-[6px] size-[6px] shrink-0 rounded-full bg-[#BF2330]" />
              <div className="flex flex-col gap-[3px]">
                <span className="text-[13px] font-semibold tracking-[-0.01em] text-[#8f1a24]">Sign-in failed</span>
                <span className="text-[13px] leading-[1.5] text-[#a04249]">{formError}</span>
              </div>
            </div>
          )}

          {signedIn && (
            <div className="flex items-center gap-[11px] rounded bg-[#171717] p-[14px]">
              <span className="size-[6px] shrink-0 animate-pulse rounded-full bg-white" />
              <span className="text-[13px] tracking-[-0.01em] text-white">
                Signed in — taking you to your workspace…
              </span>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-[18px]">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="flex flex-col gap-[7px] space-y-0">
                    <FormLabel className="text-[12.5px] font-medium tracking-[-0.005em] text-[#171717]">
                      Email address
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        autoComplete="username"
                        placeholder="you@organisation.com"
                        disabled={isBusy}
                        className="h-[46px] rounded border-[#e0e0e0] px-[14px] text-[14.5px] transition-[border-color,box-shadow] duration-150 hover:border-[#c4c4c4] focus-visible:border-[#171717] focus-visible:ring-[3px] focus-visible:ring-[#171717]/[0.09] focus-visible:ring-offset-0"
                      />
                    </FormControl>
                    <FormMessage className="text-[12px]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="flex flex-col gap-[7px] space-y-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <FormLabel className="text-[12.5px] font-medium tracking-[-0.005em] text-[#171717]">
                        Password
                      </FormLabel>
                      {/* TODO: point at a real reset route once it exists */}
                      <a href="#" className="text-[12px] text-[#737373] no-underline hover:text-[#171717]">
                        Forgot password?
                      </a>
                    </div>
                    <FormControl>
                      <div className="relative flex items-center">
                        <Input
                          {...field}
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          placeholder="Enter your password"
                          disabled={isBusy}
                          className="h-[46px] rounded border-[#e0e0e0] pl-[14px] pr-[74px] text-[14.5px] transition-[border-color,box-shadow] duration-150 hover:border-[#c4c4c4] focus-visible:border-[#171717] focus-visible:ring-[3px] focus-visible:ring-[#171717]/[0.09] focus-visible:ring-offset-0"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          disabled={isBusy}
                          className="absolute right-[6px] inline-flex h-[34px] items-center rounded-[3px] px-[10px] font-mono text-[10px] uppercase tracking-[0.14em] text-[#737373] hover:bg-[#f5f5f5] hover:text-[#171717]"
                        >
                          {showPassword ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage className="text-[12px]" />
                  </FormItem>
                )}
              />

              {/* NOTE: presentational until session persistence is wired in useAuth —
                  pass rememberMe into login() (or set the supabase session
                  persistence flag) before shipping this as a real promise. */}
              <label className="-mt-0.5 flex cursor-pointer select-none items-center gap-[9px]">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={rememberMe}
                  onClick={() => setRememberMe((v) => !v)}
                  className="relative size-4 shrink-0 rounded-[3px] border border-[#d0d0d0] bg-white"
                >
                  {rememberMe && (
                    <span className="absolute -inset-px grid place-items-center rounded-[3px] bg-[#171717]">
                      <Check className="size-[10px] text-white" strokeWidth={3} />
                    </span>
                  )}
                </button>
                <span className="text-[13px] text-[#525252]">Keep me signed in on this device</span>
              </label>

              <button
                type="submit"
                disabled={isBusy}
                className="mt-1 inline-flex h-[46px] w-full items-center justify-center gap-2 rounded bg-[#171717] text-[14.5px] font-medium tracking-[-0.008em] text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-black active:translate-y-px disabled:opacity-100"
              >
                {isBusy ? (
                  <span className="inline-flex items-center gap-[9px] opacity-85">
                    <span className="size-[6px] animate-pulse rounded-full bg-white" />
                    Signing in…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    Sign in <span className="text-[15px] leading-none">→</span>
                  </span>
                )}
              </button>
            </form>
          </Form>

          <div className="flex flex-col gap-3 border-t border-[#ebebeb] pt-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#737373]">No account yet</span>
            <p className="m-0 text-pretty text-[13px] leading-[1.6] text-[#737373]">
              Accounts are approved by the Digital SC Lab. Email{' '}
              <a href="mailto:phu.nguyen@hwr-berlin.de" className="font-medium text-[#BF2330] hover:underline">
                phu.nguyen@hwr-berlin.de
              </a>{' '}
              to request access.
            </p>
          </div>
        </div>
      </div>

      <AuthHeroStrip />
    </div>
  );
};

export default Auth;
