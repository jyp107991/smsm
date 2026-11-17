/// <reference types="node" />
// The two-user suite reads sign-in codes from the local stack's mail catcher (docs/slices/S2-ci.md,
// "The sign-in email"). CI run 44032201912 failed 20 of 21 scenarios because the local auth server's own
// default email holds only a link. These checks keep the suite's mail reader and the CI job in step.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractCode } from '../e2e/two-users/mail';

const codeTemplate = readFileSync('supabase/templates/code.html', 'utf8');

describe('sign-in email for the two-user suite', () => {
  it('reads the code from the app’s code email (supabase/templates/code.html)', () => {
    expect(codeTemplate).toContain('{{ .Token }}');
    expect(extractCode(codeTemplate.replace('{{ .Token }}', '071936'))).toBe('071936');
  });

  it('finds no code in GoTrue 2.198’s default sign-in email, which holds only a link', () => {
    const linkOnly =
      '<h2>Your sign-in link</h2>\n\n<p>Follow the link below to sign in. This link expires shortly and can only be used once.</p>\n' +
      '<p><a href="http://127.0.0.1:54321/auth/v1/verify?token=7f3a1c2e9b0d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b&amp;type=magiclink">Sign in</a></p>';
    expect(extractCode(linkOnly)).toBeNull();
  });

  it('the committed config sends the code email for new and returning sign-ins (owner approved, 17 Nov)', () => {
    const config = readFileSync('supabase/config.toml', 'utf8');
    for (const kind of ['magic_link', 'confirmation']) {
      expect(config).toMatch(new RegExp(String.raw`^\[auth\.email\.template\.${kind}\]\s+subject = "[^"]+"\s+content_path = "\./supabase/templates/code\.html"`, 'm'));
    }
    expect(existsSync('supabase/templates/code.html')).toBe(true);
  });

  it('the live sender comes only from secrets: no address or password is written in the repo', () => {
    const config = readFileSync('supabase/config.toml', 'utf8');
    const smtp = config.slice(config.indexOf('[auth.email.smtp]'));
    expect(smtp).toMatch(/^user = "env\(SUPABASE_SMTP_USER\)"$/m);
    expect(smtp).toMatch(/^pass = "env\(SUPABASE_SMTP_PASS\)"$/m);
    expect(smtp).toMatch(/^admin_email = "env\(SUPABASE_SMTP_USER\)"$/m);
    expect(config).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
  });

  it('the CI two-user job removes the real sender in its workspace, so codes stay in the local mail catcher', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const job = ci.slice(ci.indexOf('\n  two-users:'), ci.indexOf('npx supabase start', ci.indexOf('\n  two-users:')));
    const awk = /awk '(\/.+?)' supabase\/config\.toml > config\.tmp/.exec(job);
    expect(awk).not.toBeNull();
    expect(job).toMatch(/grep -q 'auth\.email\.smtp' supabase\/config\.toml; then .*exit 1/);
    // Apply the same filter in JavaScript to the committed config: the SMTP block goes, the templates stay.
    const lines = readFileSync('supabase/config.toml', 'utf8').split('\n');
    let skip = false;
    const kept = lines.filter((line) => {
      if (/^\[auth\.email\.smtp\]/.test(line)) { skip = true; return false; }
      if (skip && /^(\[|#)/.test(line)) skip = false;
      return !skip;
    }).join('\n');
    const settings = kept.split('\n').filter((l) => !l.startsWith('#')).join('\n');   // comments may name the secrets
    expect(settings).not.toMatch(/smtp|SUPABASE_SMTP/);
    expect(kept).toMatch(/^\[auth\.email\.template\.magic_link\]/m);
    expect(kept).toMatch(/^\[auth\.email\.template\.confirmation\]/m);
    expect(kept).toMatch(/^\[auth\.sms\]/m);
  });
});
