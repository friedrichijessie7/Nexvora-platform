const express=require('express');
const helmet=require('helmet');
const cors=require('cors');
const cookieParser=require('cookie-parser');
const compression=require('compression');
const morgan=require('morgan');
const path=require('path');
const env=require('./config/env');
const {globalLimiter}=require('./middleware/rateLimiter');
const publicRoutes=require('./routes/publicRoutes');
const authRoutes=require('./routes/authRoutes');
const adminRoutes=require('./routes/adminRoutes');
const customerRoutes=require('./routes/customerRoutes');
const app=express();
app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],scriptSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','https:'],connectSrc:["'self'"]}}}));
const allowAnyOrigin = env.ALLOWED_ORIGINS.includes('*');
app.use((req, res, next) => {
  const origin = req.get('origin');
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
  const protocol = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim().replace(/:$/, '').toLowerCase();
  let sameOrigin = false;

  if (origin && host) {
    try {
      const parsedOrigin = new URL(origin);
      sameOrigin = parsedOrigin.host.toLowerCase() === host && parsedOrigin.protocol.replace(/:$/, '').toLowerCase() === protocol;
    } catch {
      sameOrigin = false;
    }
  }

  const developmentOrigin = env.NODE_ENV !== 'production' && origin && (() => {
    try {
      return ['http:', 'https:'].includes(new URL(origin).protocol);
    } catch {
      return false;
    }
  })();

  if (origin && !sameOrigin && !allowAnyOrigin && !developmentOrigin && !env.ALLOWED_ORIGINS.includes(origin)) {
    return next(Object.assign(new Error('Origin not allowed'), { status: 403, code: 'CORS_DENIED' }));
  }

  return cors({
    origin: allowAnyOrigin ? '*' : (origin || false),
    credentials: !allowAnyOrigin,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })(req, res, next);
});
app.use(compression());app.use(express.json({limit:'100kb'}));app.use(cookieParser());app.use(morgan(env.NODE_ENV==='production'?'combined':'dev'));app.use(globalLimiter());
app.get('/health',(req,res)=>res.json({success:true,data:{status:'healthy',service:env.COMPANY_NAME,timestamp:new Date().toISOString()}}));
app.use('/api/track',publicRoutes);app.use('/api/auth',authRoutes);app.use('/api/admin',adminRoutes);app.use('/api/customer',customerRoutes);
const staticDir = process.env.STATIC_DIR || path.join(__dirname, '..', 'public');
app.use(express.static(staticDir, { index: 'index.html', maxAge: env.NODE_ENV === 'production' ? '1d' : 0 }));
app.use('/api',(req,res)=>res.status(404).json({success:false,error:'API endpoint not found.',code:'NOT_FOUND'}));
app.get('/{*path}',(req,res)=>res.sendFile(path.join(staticDir,'index.html')));
app.use((err,req,res,next)=>{const status=err.type==='entity.parse.failed'?400:(err.status||500);console.error(`[${req.method}] ${req.path}`,err.message);res.status(status).json({success:false,error:status===500&&env.NODE_ENV==='production'?'An internal error occurred.':err.message,code:err.code||(status===400?'INVALID_JSON':'INTERNAL_ERROR')});});
if(require.main===module){app.listen(env.PORT,()=>console.log(`Control Center API listening on :${env.PORT}`));}
module.exports=app;
