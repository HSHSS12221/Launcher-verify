# HSH Launcher Verify

This is a standalone Discord OAuth service used only by the HSH SovereignSoul Launcher's **Login** button. It is separate from the Discord server bot project (`hsh-discord-bot`), which continues to manage verification panels, submitted player details, and approval DMs.

The Launcher Verify service authenticates a Discord account with the `identify` OAuth scope, checks that account's Discord ID against approved rows in Supabase `whitelists`, and returns the result to the waiting Launcher session. The Launcher additionally checks that the whitelist row's Steam ID matches the local Steam account.

## Discord application setup

Create a separate Discord application for Launcher Verify in the Developer Portal. It does not need a bot user or server invite. In OAuth2, add this exact redirect URL after creating the Render service:

`https://YOUR-LAUNCHER-VERIFY.onrender.com/oauth/callback`

Use the application's Client ID and Client Secret as `DISCORD_OAUTH_CLIENT_ID` and `DISCORD_OAUTH_CLIENT_SECRET`.

## Supabase

Run the admin project's updated `schema.sql` in Supabase SQL Editor. It creates the short-lived `launcher_login_sessions` table used for the browser-to-Launcher handoff. The service uses the same Supabase project and server-side service role key as the admin web service; never put the service role key in the Launcher.

## Deploy to Render

Create a separate **Web Service** with this folder as its Root Directory, Build Command `npm install`, and Start Command `npm start`. Set all values from `.env.example` in Render Environment. Set `DISCORD_OAUTH_REDIRECT_URI` to the service's public HTTPS URL plus `/oauth/callback`, and add the exact same URL under Discord Developer Portal → OAuth2 → Redirects.

On the admin web service, set `LAUNCHER_VERIFY_PUBLIC_URL` to `https://YOUR-LAUNCHER-VERIFY.onrender.com`. Keep `DISCORD_BOT_API_URL` configured for the separate server bot as before. Redeploy the web service after changing its environment.

## Routes

- `GET /oauth/launcher?state=<random-session-id>` begins Discord OAuth.
- `GET /oauth/callback` validates Discord identity and checks the approved whitelist.
- `GET /public/launcher-session/:id` lets only the Launcher holding the random session ID read the result.
- `GET /health` checks service availability.

If the Discord account has no approved whitelist entry, Launcher opens the existing Discord server's Verify channel. The player submits their nickname, Steam ID, and Discord ID there; after admin approval, the connected Launcher receives a whitelist refresh command.
