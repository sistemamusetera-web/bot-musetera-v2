import { TRPCError } from '@trpc/server';
import { COOKIE_NAME } from '@shared/const';
import { getSessionCookieOptions } from './_core/cookies';
import { adminProcedure, publicProcedure, router } from './_core/trpc';
import { supabaseAdmin } from './supabase';

async function evolutionState(instance: string) {
  const base = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '');
  const key = process.env.EVOLUTION_API_KEY;
  if (!base || !key) return { state: 'not_configured' };
  const response = await fetch(`${base}/instance/connectionState/${encodeURIComponent(instance)}`, { headers: { apikey: key } });
  if (!response.ok) return { state: 'error' };
  const body = await response.json() as { instance?: { state?: string } };
  return { state: body.instance?.state ?? 'unknown' };
}

export const appRouter = router({
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  admin: router({
    overview: adminProcedure.query(async () => {
      const [instances, conversations] = await Promise.all([
        supabaseAdmin.from('whatsapp_instances').select('id,instance_name,phone,label,is_active,updated_at').order('updated_at', { ascending: false }),
        supabaseAdmin.from('conversations').select('id,phone,contact_name,status,current_menu,last_message_at,updated_at').order('last_message_at', { ascending: false }).limit(50),
      ]);
      if (instances.error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: instances.error.message });
      if (conversations.error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: conversations.error.message });
      const states = await Promise.all((instances.data ?? []).map(async row => ({ ...row, connection: await evolutionState(row.instance_name) })));
      return { instances: states, conversations: conversations.data ?? [] };
    }),
    messages: adminProcedure.input((value: unknown) => {
      if (!value || typeof value !== 'object' || !('conversationId' in value) || typeof (value as { conversationId?: unknown }).conversationId !== 'string') throw new TRPCError({ code: 'BAD_REQUEST', message: 'conversationId inválido' });
      return value as { conversationId: string };
    }).query(async ({ input }) => {
      const result = await supabaseAdmin.from('messages').select('id,direction,sender,content,message_type,created_at').eq('conversation_id', input.conversationId).order('created_at', { ascending: true }).limit(200);
      if (result.error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message });
      return result.data ?? [];
    }),
  }),
});

export type AppRouter = typeof appRouter;
