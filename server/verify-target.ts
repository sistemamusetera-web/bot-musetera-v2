async function main() {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Supabase server secrets are not configured');
  const tables = ['profiles', 'user_roles', 'whatsapp_instances', 'conversations', 'messages', 'bot_state', 'pix_charges', 'bug_reports'];
  const report: Record<string, unknown> = {};
  for (const table of tables) {
    const response = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    report[table] = { status: response.status, available: response.ok };
  }
  console.log(JSON.stringify(report, null, 2));
}

void main();
export {};
