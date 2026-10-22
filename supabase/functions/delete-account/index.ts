/**
 * Permanently deletes the signed-in runner's account and everything stored for them:
 * rewards, Strava connection and activities, and push tokens (all cascade from auth.users).
 * Strava access is revoked as well.
 *
 * The caller is verified in code with Supabase Auth (config.toml sets verify_jwt = false),
 * and the request must carry the confirmation the runner typed in the app.
 */
import { deleteAccount } from '../_shared/account.ts';
import {
  authenticatedUserId,
  createTokenStore,
  json,
  loadContext,
  logError,
  type ServerContext,
} from '../_shared/server.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let ctx: ServerContext;
  try {
    ctx = await loadContext();
  } catch (error) {
    logError('account.config', error);
    return json({ error: 'not_configured' }, 500);
  }

  const userId = await authenticatedUserId(req, ctx.admin);
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };

  try {
    const result = await deleteAccount(userId, body.confirm, {
      store: createTokenStore(ctx.admin),
      api: ctx.api,
      cipher: ctx.cipher,
      now: Date.now,
      async deleteUser(id) {
        const { error } = await ctx.admin.auth.admin.deleteUser(id);
        if (error) logError('account.delete.user', error);
        return { ok: !error };
      },
      logError,
    });
    if (!result.deleted) {
      return json({ error: result.error }, result.error === 'confirmation_required' ? 400 : 500);
    }
    return json(result);
  } catch (error) {
    logError('account.delete', error);
    return json({ error: 'server_error' }, 500);
  }
});
