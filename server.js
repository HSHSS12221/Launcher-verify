require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DISCORD_OAUTH_CLIENT_ID', 'DISCORD_OAUTH_CLIENT_SECRET', 'DISCORD_OAUTH_REDIRECT_URI'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
if (!validRedirectUri(process.env.DISCORD_OAUTH_REDIRECT_URI)) throw new Error('DISCORD_OAUTH_REDIRECT_URI must be an HTTPS URL ending in /oauth/callback');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, service: 'launcher-verify' }));

app.get('/oauth/launcher', async (req, res, next) => {
  try {
    const state = String(req.query.state || '');
    if (!isSessionId(state)) return res.status(400).send('Invalid launcher session. Return to the Launcher and try again.');
    const { error } = await supabase.from('launcher_login_sessions').upsert({
      id: state,
      status: 'pending',
      discord_id: null,
      steam_id: null,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (error) throw error;

    const params = new URLSearchParams({
      client_id: process.env.DISCORD_OAUTH_CLIENT_ID,
      redirect_uri: process.env.DISCORD_OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify',
      state
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  } catch (error) { next(error); }
});

app.get('/oauth/callback', async (req, res) => {
  const state = String(req.query.state || '');
  const code = String(req.query.code || '');
  if (!isSessionId(state) || !code) return res.status(400).send(page('Login cancelled', 'Return to HSH Launcher and try again.'));
  try {
    const { data: session, error: readError } = await supabase.from('launcher_login_sessions')
      .select('id,expires_at').eq('id', state).maybeSingle();
    if (readError) throw readError;
    if (!session || Date.parse(session.expires_at) < Date.now()) return res.status(410).send(page('Login expired', 'Return to HSH Launcher and press Login again.'));

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_OAUTH_CLIENT_ID,
        client_secret: process.env.DISCORD_OAUTH_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_OAUTH_REDIRECT_URI
      })
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) throw new Error('Discord OAuth token exchange failed');

    const userResponse = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const user = await userResponse.json();
    if (!userResponse.ok || !/^\d{17,20}$/.test(String(user.id || ''))) throw new Error('Could not read authenticated Discord account');

    const { data: whitelist, error: whitelistError } = await supabase.from('whitelists')
      .select('steam_id,status').eq('discord_id', user.id).eq('status', 'approved').limit(1).maybeSingle();
    if (whitelistError) throw whitelistError;

    const { error: updateError } = await supabase.from('launcher_login_sessions').update({
      status: whitelist ? 'approved' : 'not_whitelisted',
      discord_id: user.id,
      steam_id: whitelist?.steam_id || null,
      updated_at: new Date().toISOString()
    }).eq('id', state);
    if (updateError) throw updateError;
    return res.send(page(whitelist ? 'Discord confirmed' : 'Whitelist not found', whitelist
      ? 'Return to HSH Launcher. It is checking your Steam ID and whitelist status.'
      : 'Return to HSH Launcher. It will open the Discord Verify channel so you can submit your player information.'));
  } catch (error) {
    console.error('[Launcher Verify OAuth]', error.message);
    return res.status(500).send(page('Discord login failed', 'Return to HSH Launcher and try again.'));
  }
});

app.get('/public/launcher-session/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    if (!isSessionId(id)) return res.status(400).json({ error: 'Invalid session' });
    const { data, error } = await supabase.from('launcher_login_sessions')
      .select('status,discord_id,steam_id,expires_at').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data || Date.parse(data.expires_at) < Date.now()) return res.status(410).json({ error: 'Session expired' });
    res.set('Cache-Control', 'no-store').json(data);
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error('[Launcher Verify]', error.message);
  res.status(500).json({ error: 'Launcher Verify request failed' });
});

function isSessionId(value) { return /^[a-f0-9-]{36}$/i.test(value); }
function validRedirectUri(value) {
  try { const uri = new URL(value); return uri.protocol === 'https:' && uri.pathname === '/oauth/callback' && !uri.search && !uri.hash; }
  catch { return false; }
}
function page(title, message) {
  return `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="margin:0;background:#070707;color:#f4d27a;font:16px system-ui;text-align:center;padding:15vh 24px"><main style="max-width:560px;margin:auto;border:1px solid #8f6b20;border-radius:18px;background:#15130e;padding:32px"><h1>${title}</h1><p style="color:#ddd">${message}</p><p style="color:#888">You may close this browser tab.</p></main></body></html>`;
}

const port = Number(process.env.PORT) || 3002;
app.listen(port, () => console.log(`HSH Launcher Verify listening on ${port}`));
