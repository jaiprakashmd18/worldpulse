// Public runtime configuration. Environment variables (see .env.example), when set,
// override these values at build time. Empty Supabase values = demo mode.
// Only ever put the PUBLIC anon/publishable key here — never the service-role key.
window.WORLDPULSE_CONFIG = {
  supabaseUrl: 'https://laidkrteykpqggeznaaa.supabase.co',
  supabaseAnonKey: 'sb_publishable_botBmCKEUBQwdBtSdWp45Q_zpCfW8J6',
  pollIntervalMs: 60000,
  contactEmail: '',
  githubUrl: '',
};
