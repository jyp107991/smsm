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

  it('the CI two-user job turns the code email on for new and returning sign-ins, in its workspace only', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const job = ci.slice(ci.indexOf('\n  two-users:'), ci.indexOf('npx supabase start', ci.indexOf('\n  two-users:')));
    for (const kind of ['magic_link', 'confirmation']) {
      expect(job).toMatch(new RegExp(String.raw`\[auth\.email\.template\.${kind}\]\s+subject = "[^"]+"\s+content_path = "\./supabase/templates/code\.html"`));
    }
    expect(existsSync('supabase/templates/code.html')).toBe(true);
    // The committed config keeps the template commented until the owner approves the auth push.
    expect(readFileSync('supabase/config.toml', 'utf8')).not.toMatch(/^\[auth\.email\.template\./m);
  });
});
