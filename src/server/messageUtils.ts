import { env } from './env';

export function reformatSignedUrl(signedUrl: string): string {
  const supabaseHost = (
    env('ENVIRONMENT') === 'local' ? env('NGROK_URL') : env('VITE_SUPABASE_URL')
  ).trim();

  const url = new URL(signedUrl);
  return `${supabaseHost}${url.pathname}${url.search}`;
}
