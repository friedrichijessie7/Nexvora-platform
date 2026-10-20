import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { getGetCurrentUserQueryKey, useLogin, useSignupCustomer } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

function Brand() {
  return <Link href="/" className="brand" aria-label="NEXVORA home" data-testid="link-brand-home">NEXVORA<span className="brand-mark">.</span></Link>;
}

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const login = useLogin();
  const signup = useSignupCustomer();
  const isSignup = mode === 'signup';
  const pending = login.isPending || signup.isPending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const fields = new FormData(event.currentTarget);
    const input = { email: String(fields.get('email') || '').trim(), password: String(fields.get('password') || '') };
    try {
      if (isSignup) {
        const response = await signup.mutateAsync({ data: input });
        if (!response.success) throw new Error('We could not create your account. Please try again.');
        await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        setLocation('/account');
      } else {
        const response = await login.mutateAsync({ data: input });
        if (!response.success) throw new Error('Sign in could not be completed. Check your details and try again.');
        await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        setLocation(response.data.user.role === 'customer' ? '/account' : '/pages/admin.html');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not complete that request. Please try again.');
    }
  }

  return (
    <main className="auth-shell">
      <nav className="top-nav" aria-label="Main navigation">
        <Brand />
        <Link href="/" className="nav-link" data-testid="link-track-shipment"><ArrowLeft size={15} /> Track a shipment</Link>
      </nav>
      <div className="auth-grid">
        <section className="auth-intro">
          <p className="eyebrow">{isSignup ? 'Your shipment, in view' : 'Secure account access'}</p>
          <h1>{isSignup ? <>Know where<br />things stand.</> : <>Good to see<br />you again.</>}</h1>
          <p>{isSignup
            ? 'Create a customer account to keep assigned shipments together and follow every verified movement.'
            : 'One secure sign-in for shipment owners and approved network operators.'}</p>
          <p className="result-meta"><ShieldCheck size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} /> Private account access is protected by secure, same-origin session cookies.</p>
        </section>
        <section className="panel auth-card">
          <p className="eyebrow">{isSignup ? 'Customer registration' : 'NEXVORA account'}</p>
          <h2>{isSignup ? 'Create your account' : 'Sign in'}</h2>
          <p className="result-meta" style={{ marginTop: 5 }}>{isSignup ? 'Customer access only. Operator roles are assigned separately.' : 'Enter the email and password associated with your account.'}</p>
          <form className="auth-fields" onSubmit={submit}>
            <div>
              <label className="field-label" htmlFor="auth-email">Email address</label>
              <input className="field" id="auth-email" name="email" type="email" placeholder="you@company.com" autoComplete="email" required maxLength={254} data-testid="input-auth-email" />
            </div>
            <div>
              <label className="field-label" htmlFor="auth-password">Password</label>
              <input className="field" id="auth-password" name="password" type="password" placeholder={isSignup ? 'At least 12 characters' : 'Your password'} autoComplete={isSignup ? 'new-password' : 'current-password'} required minLength={isSignup ? 12 : 1} maxLength={72} data-testid="input-auth-password" />
            </div>
            {!isSignup && <div style={{ textAlign: 'right', marginTop: -5 }}><Link href="/forgot-password" className="text-link" data-testid="link-forgot-password">Forgot password?</Link></div>}
            {error && <p className="error-text" role="alert" data-testid="status-auth-error">{error}</p>}
            <button className="button-primary" type="submit" disabled={pending} data-testid="button-auth-submit">{pending ? 'Please wait…' : isSignup ? 'Create customer account' : 'Sign in'} <ArrowUpRight size={15} style={{ verticalAlign: 'middle', marginLeft: 5 }} /></button>
          </form>
          <p className="auth-switch">{isSignup ? 'Already have an account?' : 'New to NEXVORA?'}{' '}
            <Link href={isSignup ? '/login' : '/signup'} data-testid="link-auth-switch">{isSignup ? 'Sign in' : 'Create a customer account'}</Link>
          </p>
        </section>
      </div>
      <footer className="footer-note footer-row">NEXVORA · Supply chain visibility</footer>
    </main>
  );
}

export function ForgotPasswordPage() {
  return (
    <main className="auth-shell">
      <nav className="top-nav" aria-label="Main navigation"><Brand /><Link href="/login" className="nav-link" data-testid="link-return-login"><ArrowLeft size={15} /> Return to sign in</Link></nav>
      <div className="auth-grid">
        <section className="auth-intro"><p className="eyebrow">Account support</p><h1>Let’s get you<br />back on track.</h1><p>Password recovery is handled by the NEXVORA support team. This page does not send a reset email.</p></section>
        <section className="panel auth-card">
          <p className="eyebrow">Password help</p><h2>Contact your account administrator</h2>
          <p className="result-meta">For a customer account, reply to the shipment or onboarding communication you received from your NEXVORA contact. For operator access, use your organization’s approved support channel.</p>
          <div className="notice" role="note" data-testid="notice-password-recovery">For your security, we can’t confirm whether an email address has an account or claim that a reset email was sent.</div>
          <p className="auth-switch"><Link href="/login" data-testid="link-back-signin">Back to sign in</Link></p>
        </section>
      </div>
      <footer className="footer-note footer-row">NEXVORA · Account support</footer>
    </main>
  );
}
