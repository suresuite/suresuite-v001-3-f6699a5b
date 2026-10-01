// "Forgot password?" on the sign-in page (PLAN.md §4 D251) — part of /auth, so it
// lives beside `Auth.tsx` and shares its skin (§C6 allows /auth its black button).
//
// The person types their email and a super admin is told; nothing about the account
// changes here. The confirmation reads the same whether or not the email has an
// account, so this form cannot be used to find out which emails do — the database
// answers identically too (`request_password_reset`).
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { requestPasswordReset } from '@/lib/auth/passwordReset';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INPUT_CLASS =
  'h-[46px] rounded-[6px] border-[#d4d4d4] px-[14px] text-[14.5px] md:rounded md:border-[#e0e0e0] transition-[border-color,box-shadow] duration-150 hover:border-[#c4c4c4] focus-visible:border-[#171717] focus-visible:ring-[3px] focus-visible:ring-[#171717]/[0.09] focus-visible:ring-offset-0';
const BUTTON_CLASS =
  'mt-1 inline-flex h-[46px] w-full items-center justify-center gap-2 rounded-[6px] bg-[#18181b] text-[13.5px] font-semibold tracking-[-0.008em] text-white transition-[background-color,transform] duration-150 hover:bg-black active:translate-y-px disabled:opacity-100 md:rounded md:bg-[#171717] md:text-[14.5px] md:font-medium md:shadow-sm';

export default function ForgotPasswordPanel({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL.test(value)) {
      setInvalid('Please enter a valid email address');
      return;
    }
    setInvalid(null);
    setFailed(false);
    setSending(true);
    const { error } = await requestPasswordReset(value);
    setSending(false);
    if (error) {
      setFailed(true);
      return;
    }
    setSentTo(value);
  };

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="self-start text-[13px] font-medium text-[#525252] hover:text-[#171717] hover:underline md:text-[#737373]"
    >
      ← Back to sign in
    </button>
  );

  if (sentTo) {
    return (
      <>
        <h1 className="m-0 text-[31px] font-semibold leading-[1.1] tracking-[-0.022em]">
          Request <span className="font-serif italic font-medium">received.</span>
        </h1>
        <div className="flex flex-col gap-3 text-[13.5px] leading-[1.6] text-[#3f3f46]">
          <p className="m-0">
            If <span className="font-medium text-[#171717]">{sentTo}</span> belongs to an active account, our
            administrator has been notified.
          </p>
          <p className="m-0">
            They will confirm it is you using the contact details already on file, then send you a temporary
            password. When you sign in with it, you will be asked to choose a new password before you continue.
          </p>
          <p className="m-0 text-[#525252] md:text-[#737373]">
            Nobody from SuReSuite will ask you for your current password.
          </p>
        </div>
        {back}
      </>
    );
  }

  return (
    <>
      <h1 className="m-0 text-[31px] font-semibold leading-[1.1] tracking-[-0.022em]">
        Forgot your <span className="font-serif italic font-medium">password?</span>
      </h1>
      <p className="m-0 text-[13.5px] leading-[1.6] text-[#525252] md:text-[#737373]">
        Enter the email you sign in with. We will ask our administrator to reset your password.
      </p>

      {failed && (
        <div className="flex items-start gap-[11px] rounded-[4px] border border-[#d4d4d4] bg-white px-[14px] py-[13px] md:rounded md:border-[#f3c9cd] md:bg-[#fdf5f5]">
          <span className="mt-[6px] size-[6px] shrink-0 rounded-full bg-[#BF2330]" />
          <div className="flex flex-col gap-[3px]">
            <span className="text-[13px] font-semibold tracking-[-0.01em] text-[#18181b] md:text-[#8f1a24]">Request not sent</span>
            <span className="text-[13px] leading-[1.5] text-[#3f3f46] md:text-[#a04249]">
              We could not reach the server. Check your connection and try again.
            </span>
          </div>
        </div>
      )}

      <form onSubmit={submit} noValidate className="flex flex-col gap-[18px]">
        <div className="flex flex-col gap-[7px]">
          <label htmlFor="forgot-email" className="text-[12.5px] font-medium tracking-[-0.005em] text-[#171717]">
            Email address
          </label>
          <Input
            id="forgot-email"
            type="email"
            autoComplete="username"
            placeholder="you@organisation.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={sending}
            autoFocus
            aria-invalid={invalid ? true : undefined}
            className={INPUT_CLASS}
          />
          {invalid && <p className="m-0 text-[12px] font-medium text-destructive">{invalid}</p>}
        </div>
        <button type="submit" disabled={sending} className={BUTTON_CLASS}>
          {sending ? (
            <span className="inline-flex items-center gap-[9px] opacity-85">
              <span className="size-[6px] animate-pulse rounded-full bg-white" />
              Sending…
            </span>
          ) : (
            'Request a password reset'
          )}
        </button>
      </form>
      {back}
    </>
  );
}
