module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    supabaseUrl:     process.env.SUPABASE_URL      || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    // "Sign in with Microsoft" (Supabase Azure provider, Etcher tenant): MICROSOFT_SIGNIN=1 once it is set up.
    microsoftSignIn: process.env.MICROSOFT_SIGNIN === '1',
  });
};
