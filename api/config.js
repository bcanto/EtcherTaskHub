module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    supabaseUrl:     process.env.SUPABASE_URL      || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    isoEnabled:      process.env.ISO_ENABLED === '1',
    // Release-1 B6.3: shows "Sign in with Microsoft" once the Supabase Azure provider is set up.
    microsoftSignIn: process.env.MICROSOFT_SIGNIN === '1',
  });
};
