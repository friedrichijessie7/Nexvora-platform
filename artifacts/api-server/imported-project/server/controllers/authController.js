const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { supabaseAdmin } = require('../services/db');
const { cleanText } = require('../middleware/validation');

const issueTokens = (user) => ({
  token: jwt.sign({ role: user.role, email: user.email }, env.JWT_SECRET, { subject: user.id, issuer: env.JWT_ISSUER, expiresIn: '15m' }),
  refreshToken: jwt.sign({ type: 'refresh' }, env.JWT_SECRET, { subject: user.id, issuer: env.JWT_ISSUER, expiresIn: '7d' }),
});
async function login(req, res, next) {
  try {
    const email = cleanText(req.body.email || '').toLowerCase();
    if (!email || typeof req.body.password !== 'string') return res.status(400).json({ success:false, error:'Email and password are required.', code:'VALIDATION_ERROR' });
    const { data: user, error } = await supabaseAdmin.from('users').select('id,email,password_hash,role,is_active,failed_attempts,locked_until').eq('email', email).maybeSingle();
    if (error || !user || !user.is_active || (user.locked_until && new Date(user.locked_until) > new Date())) return res.status(401).json({ success:false, error:'Invalid credentials.', code:'INVALID_CREDENTIALS' });
    if (!(await bcrypt.compare(req.body.password, user.password_hash))) {
      const failed = (user.failed_attempts || 0) + 1;
      await supabaseAdmin.from('users').update({ failed_attempts: failed, locked_until: failed >= 5 ? new Date(Date.now() + 30*60*1000).toISOString() : null }).eq('id', user.id);
      return res.status(401).json({ success:false, error:'Invalid credentials.', code:'INVALID_CREDENTIALS' });
    }
    await supabaseAdmin.from('users').update({ failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() }).eq('id', user.id);
    return res.json({ success:true, data:{ ...issueTokens(user), user:{ id:user.id, email:user.email, role:user.role } } });
  } catch (error) { next(error); }
}
async function refresh(req, res, next) {
  try {
    const claims = jwt.verify(req.body.refreshToken || '', env.JWT_SECRET, { issuer:env.JWT_ISSUER });
    if (claims.type !== 'refresh') throw new jwt.JsonWebTokenError('Not a refresh token');
    const { data:user } = await supabaseAdmin.from('users').select('id,email,role,is_active').eq('id', claims.sub).maybeSingle();
    if (!user?.is_active) return res.status(401).json({ success:false,error:'Account is unavailable.',code:'ACCOUNT_UNAVAILABLE' });
    return res.json({ success:true, data:issueTokens(user) });
  } catch (_) { return res.status(401).json({success:false,error:'Invalid refresh token.',code:'INVALID_REFRESH_TOKEN'}); }
}
async function logout(req,res) { return res.json({ success:true, data:{ message:'Session ended. Remove tokens on the client.' } }); }
async function me(req,res) { return res.json({ success:true, data:{ user:req.user } }); }
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
module.exports={login,refresh,logout,me,register};
