const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { supabaseAdmin } = require('../services/db');
const { cleanText } = require('../middleware/validation');

const ACCESS_COOKIE = 'nexvora_access';
const REFRESH_COOKIE = 'nexvora_refresh';
const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
};
function setSessionCookies(res, tokens) {
  res.cookie(ACCESS_COOKIE, tokens.token, {
    ...cookieOptions,
    path: '/api',
    maxAge: 15 * 60 * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...cookieOptions,
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...cookieOptions, path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, path: '/api/auth' });
}
function validCustomerCredentials(email, password) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && email.length <= 254
    && typeof password === 'string'
    && password.length >= 12
    && Buffer.byteLength(password, 'utf8') <= 72;
}
const issueTokens = (user) => ({
  token: jwt.sign({ role: user.role, email: user.email }, env.JWT_SECRET, { subject: user.id, issuer: env.JWT_ISSUER, expiresIn: '15m' }),
  refreshToken: jwt.sign({ type: 'refresh' }, env.JWT_SECRET, { subject: user.id, issuer: env.JWT_ISSUER, expiresIn: '7d' }),
});
async function login(req, res, next) {
  try {
    const body = req.body || {};
    const email = cleanText(body.email || '').toLowerCase();
    if (!email || typeof body.password !== 'string') return res.status(400).json({ success:false, error:'Email and password are required.', code:'VALIDATION_ERROR' });
    const { data: user, error } = await supabaseAdmin.from('users').select('id,email,password_hash,role,is_active,failed_attempts,locked_until').eq('email', email).maybeSingle();
    if (error || !user || !user.is_active || (user.locked_until && new Date(user.locked_until) > new Date())) return res.status(401).json({ success:false, error:'Invalid credentials.', code:'INVALID_CREDENTIALS' });
    if (!(await bcrypt.compare(body.password, user.password_hash))) {
      const failed = (user.failed_attempts || 0) + 1;
      await supabaseAdmin.from('users').update({ failed_attempts: failed, locked_until: failed >= 5 ? new Date(Date.now() + 30*60*1000).toISOString() : null }).eq('id', user.id);
      return res.status(401).json({ success:false, error:'Invalid credentials.', code:'INVALID_CREDENTIALS' });
    }
    await supabaseAdmin.from('users').update({ failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() }).eq('id', user.id);
    const tokens = issueTokens(user);
    setSessionCookies(res, tokens);
    return res.json({ success:true, data:{ ...tokens, user:{ id:user.id, email:user.email, role:user.role } } });
  } catch (error) { next(error); }
}
async function refresh(req, res, next) {
  try {
    const refreshToken = req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE] || '';
    const claims = jwt.verify(refreshToken, env.JWT_SECRET, { issuer:env.JWT_ISSUER });
    if (claims.type !== 'refresh') throw new jwt.JsonWebTokenError('Not a refresh token');
    const { data:user } = await supabaseAdmin.from('users').select('id,email,role,is_active').eq('id', claims.sub).maybeSingle();
    if (!user?.is_active) return res.status(401).json({ success:false,error:'Account is unavailable.',code:'ACCOUNT_UNAVAILABLE' });
    const tokens = issueTokens(user);
    setSessionCookies(res, tokens);
    return res.json({ success:true, data:tokens });
  } catch (_) { return res.status(401).json({success:false,error:'Invalid refresh token.',code:'INVALID_REFRESH_TOKEN'}); }
}
async function logout(req,res) {
  clearSessionCookies(res);
  return res.json({ success:true, data:{ message:'Session ended.' } });
}
async function me(req,res) {
  const { id, email, role } = req.user;
  return res.json({ success:true, data:{ user:{ id, email, role } } });
}
async function signup(req, res, next) {
  try {
    const body = req.body || {};
    const email = cleanText(body.email || '').toLowerCase();
    const password = body.password;
    if (!validCustomerCredentials(email, password)) {
      return res.status(400).json({ success:false, error:'Use a valid email and a password of at least 12 characters.', code:'VALIDATION_ERROR' });
    }

    const { data:user, error } = await supabaseAdmin
      .from('users')
      .insert({
        email,
        password_hash: await bcrypt.hash(password, env.BCRYPT_ROUNDS),
        role: 'customer',
        security_clearance: 'standard',
      })
      .select('id,email,role')
      .single();
    if (error?.code === '23505') {
      return res.status(409).json({ success:false, error:'An account with this email already exists.', code:'EMAIL_EXISTS' });
    }
    if (error) throw error;

    const tokens = issueTokens(user);
    setSessionCookies(res, tokens);
    return res.status(201).json({ success:true, data:{ ...tokens, user } });
  } catch (error) {
    next(error);
  }
}
async function register(req,res,next) {
  try {
    const email=cleanText(req.body.email||'').toLowerCase(), password=req.body.password, role=req.body.role || 'viewer';
    if (!email || typeof password !== 'string' || password.length < 12 || !['operator','viewer','customer','superadmin'].includes(role)) return res.status(400).json({success:false,error:'Invalid account payload.',code:'VALIDATION_ERROR'});
    const {data,error}=await supabaseAdmin.from('users').insert({email,password_hash:await bcrypt.hash(password,env.BCRYPT_ROUNDS),role,security_clearance:cleanText(req.body.security_clearance||'standard',50)}).select('id,email,role,security_clearance').single();
    if(error?.code==='23505') return res.status(409).json({success:false,error:'Email already exists.',code:'EMAIL_EXISTS'});
    if(error) throw error;
    return res.status(201).json({success:true,data:{user:data}});
  } catch(error){next(error);}
}
module.exports={login,refresh,logout,me,signup,register};
