const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
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
    const { data: user, error } = await supabaseAdmin.from('users').select('id,email,password_hash,role,is_active,email_verified,failed_attempts,locked_until').eq('email', email).maybeSingle();
    if (error || !user || !user.is_active || (user.locked_until && new Date(user.locked_until) > new Date())) return res.status(401).json({ success:false, error:'Invalid credentials.', code:'INVALID_CREDENTIALS' });
    if (!(await bcrypt.compare(body.password, user.password_hash))) {
      const failed = (user.failed_attempts || 0) + 1;
      await supabaseAdmin.from('users').update({ failed_attempts: failed, locked_until: failed >= 5 ? new Date(Date.now() + 30*60*1000).toISOString() : null }).eq('id', user.id);
      return res.status(401).json({ success:false, error:'Invalid credentials.', code:'INVALID_CREDENTIALS' });
    }
    if (user.email_verified === false) return res.status(403).json({ success:false, error:'Please verify your email first', code:'EMAIL_NOT_VERIFIED' });
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
    const name = cleanText(body.name || body.full_name || 'Customer', 120);
    const password = body.password;
    if (!validCustomerCredentials(email, password) || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ success:false, error:'Use a valid email and a password of at least 12 characters with a letter and number.', code:'VALIDATION_ERROR' });
    }
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const { data:user, error } = await supabaseAdmin.from('users').insert({
      email, password_hash: await bcrypt.hash(password, env.BCRYPT_ROUNDS), role:'customer', security_clearance:'standard',
      email_verified:false, verification_token_hash:tokenHash, verification_expires_at:new Date(Date.now()+86400000).toISOString(),
      account_type: body.account_type === 'business' ? 'business' : 'personal', company_name: cleanText(body.company_name || '', 160) || null,
      full_name: name,
    }).select('id,email,role').single();
    if (error?.code === '23505') return res.status(409).json({ success:false, error:'An account with this email already exists.', code:'EMAIL_EXISTS' });
    if (error) throw error;
    const base = process.env.APP_BASE_URL || `http://localhost:${env.PORT}`;
    await sendVerificationEmail(email, `${base}/api/auth/verify?token=${rawToken}`, name);
    return res.status(201).json({ success:true, data:{ message:'Check your email to verify your account.' } });
  } catch (error) { next(error); }
}
async function verifyEmail(req,res,next){
  try {
    const token=String(req.query.token||''); const hash=crypto.createHash('sha256').update(token).digest('hex');
    const {data:user,error}=await supabaseAdmin.from('users').select('id,verification_expires_at').eq('verification_token_hash',hash).maybeSingle();
    if(error) throw error;
    if(!user || new Date(user.verification_expires_at) < new Date()) return res.redirect('/login.html?error=expired');
    await supabaseAdmin.from('users').update({email_verified:true,verification_token_hash:null,verification_expires_at:null}).eq('id',user.id);
    return res.redirect('/login.html?verified=1');
  } catch(error){ next(error); }
}
async function resendVerification(req,res,next){
  try { const email=cleanText(req.body?.email||'').toLowerCase(); const {data:user}=await supabaseAdmin.from('users').select('id,email,full_name,email_verified').eq('email',email).maybeSingle(); if(user && !user.email_verified){const raw=crypto.randomBytes(32).toString('hex'); await supabaseAdmin.from('users').update({verification_token_hash:crypto.createHash('sha256').update(raw).digest('hex'),verification_expires_at:new Date(Date.now()+86400000).toISOString()}).eq('id',user.id); await sendVerificationEmail(email,`${process.env.APP_BASE_URL||`http://localhost:${env.PORT}`}/api/auth/verify?token=${raw}`,user.full_name);} return res.json({success:true,data:{message:'If the account can receive email, a verification link will arrive shortly.'}}); } catch(error){next(error);}
}
async function forgotPassword(req,res,next){
  try { const email=cleanText(req.body?.email||'').toLowerCase(); const {data:user}=await supabaseAdmin.from('users').select('id,email,full_name').eq('email',email).maybeSingle(); if(user){const raw=crypto.randomBytes(32).toString('hex'); await supabaseAdmin.from('users').update({reset_token_hash:crypto.createHash('sha256').update(raw).digest('hex'),reset_expires_at:new Date(Date.now()+3600000).toISOString()}).eq('id',user.id); await sendPasswordResetEmail(email,`${process.env.APP_BASE_URL||`http://localhost:${env.PORT}`}/reset-password.html?token=${raw}`,user.full_name);} return res.json({success:true,data:{message:'If the account exists, reset instructions will arrive shortly.'}}); } catch(error){next(error);}
}
async function resetPassword(req,res,next){try{const token=String(req.body?.token||''); const hash=crypto.createHash('sha256').update(token).digest('hex'); const {data:user}=await supabaseAdmin.from('users').select('id,reset_expires_at').eq('reset_token_hash',hash).maybeSingle(); if(!user||new Date(user.reset_expires_at)<new Date()) return res.status(400).json({success:false,error:'Reset link is invalid or expired.'}); const password=req.body.password; if(!validCustomerCredentials('a@b.co',password)||!/[A-Za-z]/.test(password)||!/\d/.test(password)) return res.status(400).json({success:false,error:'Password does not meet requirements.'}); await supabaseAdmin.from('users').update({password_hash:await bcrypt.hash(password,env.BCRYPT_ROUNDS),reset_token_hash:null,reset_expires_at:null}).eq('id',user.id); return res.json({success:true,data:{message:'Password updated.'}});}catch(error){next(error);}}
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
module.exports={login,refresh,logout,me,signup,register,verifyEmail,resendVerification,forgotPassword,resetPassword};
