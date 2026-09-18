# Email sign-in setup

Unmatched Labs already requests and verifies email codes through
Supabase Auth. The last delivery attempt failed because the domain configured
for custom SMTP was not verified with the sending provider. This setup lives in
the provider and Supabase dashboards, not in the Vite app or its `.env.local`.

## No-domain pilot

You can test the email sign-in flow without buying a domain. For a small pilot,
use a dedicated Gmail address as Supabase's custom SMTP sender. This is a
temporary way to deliver codes to people outside the Supabase project team;
Gmail is not a transactional mail service and Google discourages app passwords.

1. On the dedicated Google account, enable 2-Step Verification and create an
   [app password](https://support.google.com/mail/answer/185833). If the app
   password option is unavailable for that account, use another provider.
2. In Supabase **Authentication → Emails → SMTP Settings**, enable custom SMTP
   and enter:

   | Supabase SMTP field | Gmail value |
   | --- | --- |
   | Host | `smtp.gmail.com` |
   | Port | `465` (SSL) or `587` (TLS) |
   | Username | The full dedicated Gmail address |
   | Password | The Google app password, not the account password |
   | Sender email | The same Gmail address |
   | Sender name | `Unmatched Labs` |

3. Continue with the email template and verification steps below. Test both a
   Gmail and a non-Gmail recipient. Keep the app password in Supabase only,
   never in the app's `.env.local`, a `VITE_` variable, or the repository.

Supabase's built-in sender can test email codes to project team addresses only
and is limited to two messages per hour. It cannot serve public sign-ins.

## Longer-term delivery

**Recommended provider: Resend Free.** It has a direct Supabase integration and
currently allows 100 emails per day and 3,000 per month. It requires a domain
you own; the app's Vercel preview hostname is not a sending domain you can
verify. Use a dedicated subdomain such as `auth.your-domain.example` if you
have one. Resend's integration can configure Supabase SMTP automatically after
domain verification. For a manual setup, use:

| Supabase SMTP field | Resend value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` (SMTPS) |
| Username | `resend` |
| Password | A Resend API key, not the Resend account password |
| Sender email | `no-reply@auth.your-domain.example` on the verified domain |
| Sender name | `Unmatched Labs` |

1. At Resend, add the sending domain you control. Add the exact DNS records
   Resend provides, then wait until its dashboard reports the domain as
   **verified**. A configured SMTP login alone does not verify the sender.
2. In Supabase **Authentication → Emails → SMTP Settings**, enable custom SMTP.
   Enter that provider's host, port, username and password, and set the From
   address to the verified sender. Keep SMTP credentials in the Supabase
   dashboard; never put them in a `VITE_` variable or commit them.

## Templates and limits for either provider

1. In Supabase **Authentication → Emails → Email Templates**, make the
   **Magic Link** template show `{{ .Token }}`. Do the same for **Confirm sign
   up**, so a newly created address also receives a code. For example:

   ```html
   <h2>Your Unmatched Labs sign-in code</h2>
   <p>Enter this code in the tab where you requested it:</p>
   <p><strong>{{ .Token }}</strong></p>
   <p>If you did not request it, you can ignore this email.</p>
   ```

2. Keep the Email provider enabled under **Authentication → Sign In / Providers**.
   Supabase currently reports it enabled for this project. Check **Email OTP
   length** there; Supabase supports six to ten digits, and the app accepts
   that range. Review
   **Authentication → Rate Limits** after SMTP works; the built-in sender has
   severe limits and custom SMTP starts with a separate project limit.

## Verify before relying on it

Use the app's **Sign in with email** form with both a new address and an
existing account. Confirm that each receives a code, entering the
code signs the user in, and a reload retains the session. If a request fails,
check Supabase Auth logs and the sending provider's delivery log together. A
successful request alone does not prove that a message reached an inbox.

The app calls `/auth/v1/otp` and `/auth/v1/verify`; its database policies use
the Supabase user ID, so no database migration or separate email identity path
is required. An anonymous account upgrade is a separate flow and is not
offered by the current sign-in panel.

References: [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[Supabase's Google SMTP notes](https://supabase.com/docs/guides/troubleshooting/using-google-smtp-with-supabase-custom-smtp-ZZzU4Y),
[email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), and
[OTP length](https://supabase.com/docs/guides/local-development/cli/config#authemailotp_length),
[email templates](https://supabase.com/docs/guides/auth/auth-email-templates);
[Resend's Supabase integration](https://resend.com/docs/knowledge-base/getting-started-with-resend-and-supabase),
[SMTP values](https://resend.com/docs/send-with-smtp), and
[domain verification](https://resend.com/docs/add-a-domain).
