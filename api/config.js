module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    supabaseUrl:     process.env.SUPABASE_URL      || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    // Release-1 B6.3: shows "Sign in with Microsoft" once the Supabase Azure provider is set up.
    microsoftSignIn: process.env.MICROSOFT_SIGNIN === '1',
    // Client portal logins by email link (the client confirms the address and sets their password): CLIENT_EMAIL_LINK=1.
    clientEmailLink: process.env.CLIENT_EMAIL_LINK === '1',
    // Offer two-step sign-in (authenticator app) to password logins: TWO_STEP_SIGNIN=1.
    twoStepSignIn: process.env.TWO_STEP_SIGNIN === '1',
    // Sign out after this many minutes without activity (0 or unset = never): SESSION_IDLE_MINUTES.
    sessionIdleMinutes: Math.max(0, parseInt(process.env.SESSION_IDLE_MINUTES || '0', 10) || 0),
  });
};
