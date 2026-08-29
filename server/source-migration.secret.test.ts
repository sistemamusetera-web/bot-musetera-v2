import { describe, expect, it } from 'vitest';

// Historical migration is intentionally disabled because the user does not have source-project access.
describe.skip('source migration secret', () => {
  it('can read source Supabase metadata with the one-time key', async () => {
    const sourceUrl = process.env.SOURCE_SUPABASE_URL ?? 'https://rmpqofqkmxflcgrizrym.supabase.co';
    const key = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
    expect(key, 'SOURCE_SUPABASE_SERVICE_ROLE_KEY must be supplied before migration').toBeTruthy();

    const response = await fetch(`${sourceUrl}/rest/v1/conversations?select=id&limit=1`, {
      headers: { apikey: key!, Authorization: `Bearer ${key}` },
    });
    expect(response.ok).toBe(true);
  });
});
