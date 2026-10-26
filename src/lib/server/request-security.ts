/** Cookie-authenticated mutation endpoints must carry the exact same Origin as the request URL. */
export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsedOrigin = new URL(origin);
    const requestOrigin = new URL(request.url);
    return parsedOrigin.origin === requestOrigin.origin;
  } catch {
    return false;
  }
}
