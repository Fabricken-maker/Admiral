const ALLOWED_ORIGINS = [
  'https://admiral.fabricken.se',
  'https://admiralai.se',
  'https://www.admiralai.se',
];

export function getCorsHeaders(event, methods = 'GET, POST, OPTIONS') {
  const origin = event?.headers?.origin || event?.headers?.Origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}
