export type Handler = (req: Request, env: Env) => Promise<Response>;

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export const readJson = async <T>(req: Request) => (await req.json().catch(() => null)) as T | null;

export const bearer = (req: Request) => /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];

export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  if (!env.ALLOWED_ORIGINS.split(',').includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}
