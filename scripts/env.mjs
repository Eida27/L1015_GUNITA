// Shared by native Node launchers and server code. Errors never include values.
export function validateEnv(input, mode = 'development') {
  const invalid = new Set();
  const preview = mode === 'production' && input.LOCAL_PREVIEW === 'true';
  const production = mode === 'production' && !preview;
  if (
    input.CONTAINER_PREVIEW !== undefined &&
    (input.CONTAINER_PREVIEW !== 'true' ||
      !preview ||
      input.LOCAL_PROXY !== 'true')
  )
    invalid.add('CONTAINER_PREVIEW');
  let url;
  try {
    url = new URL(
      input.APP_ORIGIN || (production ? '' : 'http://127.0.0.1:3000'),
    );
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      invalid.add('APP_ORIGIN');
    if (
      production &&
      (url.protocol !== 'https:' ||
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
      invalid.add('APP_ORIGIN');
    if (
      !production &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
      invalid.add('APP_ORIGIN');
  } catch {
    invalid.add('APP_ORIGIN');
  }
  const port = Number(input.PORT || url?.port || (production ? 3000 : 3000));
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalid.add('PORT');
  // A local reverse proxy may intentionally use a different public origin port.
  if (
    !production &&
    url &&
    Number(url.port || 80) !== port &&
    input.LOCAL_PROXY !== 'true'
  )
    invalid.add('PORT');
  const placeholder = (value) =>
    !value || /REPLACE|GENERATED_BY|CHANGE.?ME|placeholder/i.test(value);
  if (input.DATABASE_URL || production) {
    try {
      const database = new URL(input.DATABASE_URL);
      if (
        !['postgres:', 'postgresql:'].includes(database.protocol) ||
        !database.hostname ||
        !database.pathname.slice(1) ||
        placeholder(database.password)
      )
        invalid.add('DATABASE_URL');
      if (production && database.password.length < 16)
        invalid.add('DATABASE_URL');
    } catch {
      invalid.add('DATABASE_URL');
    }
  }
  if (production) {
    if (
      placeholder(input.BETTER_AUTH_SECRET) ||
      input.BETTER_AUTH_SECRET.length < 32 ||
      new Set(input.BETTER_AUTH_SECRET).size < 10
    )
      invalid.add('BETTER_AUTH_SECRET');
    for (const key of [
      'TURNSTILE_SECRET_KEY',
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
    ]) {
      if (placeholder(input[key]) || /^[123]x0{10}/.test(input[key]))
        invalid.add(key);
    }
    if (
      placeholder(input.SMTP_HOST) ||
      ['localhost', '127.0.0.1'].includes(input.SMTP_HOST)
    )
      invalid.add('SMTP_HOST');
    if (
      placeholder(input.SMTP_FROM) ||
      !/[^\s<>]+@[^\s<>]+\.[^\s<>]+/.test(input.SMTP_FROM)
    )
      invalid.add('SMTP_FROM');
    try {
      if (
        new URL(input.MAP_STYLE_URL).protocol !== 'https:' ||
        placeholder(input.MAP_STYLE_URL)
      )
        invalid.add('MAP_STYLE_URL');
    } catch {
      invalid.add('MAP_STYLE_URL');
    }
  }
  if (!production) {
    if (
      input.NEXT_PUBLIC_TURNSTILE_SITE_KEY &&
      input.NEXT_PUBLIC_TURNSTILE_SITE_KEY !== '1x00000000000000000000AA'
    )
      invalid.add('NEXT_PUBLIC_TURNSTILE_SITE_KEY');
    if (
      input.TURNSTILE_SECRET_KEY &&
      ![
        '1x0000000000000000000000000000000AA',
        '3x0000000000000000000000000000000AA',
      ].includes(input.TURNSTILE_SECRET_KEY)
    )
      invalid.add('TURNSTILE_SECRET_KEY');
  }
  // Header trust cannot be enabled without a separately verified origin proxy.
  if (input.TRUST_PROXY && input.TRUST_PROXY !== 'direct')
    invalid.add('TRUST_PROXY');
  if (invalid.size)
    throw new Error(`Invalid environment: ${[...invalid].sort().join(', ')}`);
  return {
    origin: url.origin,
    port,
    preview,
    databaseUrl: input.DATABASE_URL,
    hostname:
      preview && input.CONTAINER_PREVIEW !== 'true' ? '127.0.0.1' : '0.0.0.0',
  };
}
