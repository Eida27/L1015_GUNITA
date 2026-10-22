export const runtime = 'nodejs';
export async function GET() {
  const url = process.env.MAP_STYLE_URL;
  const local =
    process.env.NODE_ENV !== 'production' ||
    process.env.LOCAL_PREVIEW === 'true';
  // URL is operator configured, never fetched by the server or accepted from a request.
  if (url && /^https:\/\//.test(url))
    return Response.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
  if (local)
    return Response.json(
      { url: '/maps/development-style.json' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  return Response.json({ code: 'MAP_UNAVAILABLE' }, { status: 503 });
}
