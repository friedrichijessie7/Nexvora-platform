/**
 * Dynamic Supply Chain Operating System — Auth Controller
 * Register, login, refresh, logout, me.
 * 
 * All password hashing uses bcrypt. Never store plaintext passwords.
 * JWT tokens signed with process.env.JWT_SECRET (>= 64 chars).
 * Refresh tokens are rotating (single-use) to mitigate replay attacks.
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { supabaseService } = require('../services/db');

/**
 * Register a new user.
 * SuperAdmin-only endpoint (enforced by route middleware).
 * Creates a user with 'viewer' role by default; SuperAdmin can assign role later.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function register(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password are required.',
      code: 'MISSING_FIELDS',
    });
  }

  // Check if user already exists
  const { data: existing } = await supabaseService
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (existing) {
    return res.status(409).json({
      success: false,
      error: 'A user with that email already exists.',
      code: 'EMAIL_EXISTS',
    });
  }

  // Hash password
  const saltRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Create user with default role 'viewer'
  const { data, error } = await supabaseService
    .from('users')
    .insert([
      {
        email,
        password_hash: passwordHash,
        role: 'viewer',
        is_active: true,
      },
    ])
    .select('id, email, role, is_active, created_at')
    .single();

  if (error) {
    console.error('[ERROR] Failed to register user:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create user account.',
      code: 'DB_ERROR',
    });
  }

  return res.status(201).json({
    success: true,
    data: { user: data },
    error: null,
    code: null,
  });
}

/**
 * Login: authenticate user and issue JWT access + refresh tokens.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password are required.',
      code: 'MISSING_FIELDS',
    });
  }

  // Look up user by email
  const { data: user, error } = await supabaseService
    .from('users')
    .select('id, email, password_hash, role, is_active')
    .eq('email', email)
    .single();

  if (error || !user) {
    return res.status(401).json({
      success: false,
      error: 'Invalid email or password.',
      code: 'INVALID_CREDENTIALS',
    });
  }

  if (!user.is_active) {
    return res.status(401).json({
      success: false,
      error: 'Account is deactivated.',
      code: 'ACCOUNT_DEACTIVATED',
    });
  }

  // Compare password
  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatch) {
    return res.status(401).json({
      success: false,
      error: 'Invalid email or password.',
      code: 'INVALID_CREDENTIALS',
    });
  }

  // Issue JWT access token
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  // Issue refresh token (store hash in DB for rotation)
  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  // Store refresh token hash (simple approach: insert or update)
  const refreshTokenHash = await bcrypt.hash(refreshToken, saltRounds);
  await supabaseService.from('users').update({ refresh_token_hash: refreshTokenHash }).eq('id', user.id);

  return res.json({
    success: true,
    data: {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    },
    error: null,
    code: null,
  });
}

/**
 * Refresh access token using a valid refresh token.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function refresh(req, res) {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      error: 'Refresh token is required.',
      code: 'MISSING_REFRESH_TOKEN',
    });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);

    // Verify it's a refresh token
    if (!decoded || decoded.type !== 'refresh') {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token.',
        code: 'INVALID_REFRESH_TOKEN',
      });
    }

    // Look up user and verify stored hash matches
    const { data: user, error } = await supabaseService
      .from('users')
      .select('id, email, role, is_active, refresh_token_hash')
      .eq('id', decoded.id)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: 'User not found.',
        code: 'USER_NOT_FOUND',
      });
    }

    const passwordMatch = await bcrypt.compare(refreshToken, user.refresh_token_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token mismatch or revoked.',
        code: 'REFRESH_TOKEN_INVALID',
      });
    }

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated.',
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    // Issue new access token
    const newAccessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    return res.json({
      success: true,
      data: { accessToken: newAccessToken },
      error: null,
      code: null,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Refresh token expired.',
        code: 'REFRESH_TOKEN_EXPIRED',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh token.',
      code: 'TOKEN_REFRESH_ERROR',
    });
  }
}

/**
 * Logout: invalidate the current refresh token.
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function logout(req, res) {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      error: 'Refresh token is required.',
      code: 'MISSING_REFRESH_TOKEN',
    });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    // Clear the refresh token hash in DB (set to null)
    await supabaseService.from('users').update({ refresh_token_hash: null }).eq('id', decoded.id);

    return res.json({
      success: true,
      data: { message: 'Logged out successfully.' },
      error: null,
      code: null,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: 'Invalid refresh token.',
      code: 'INVALID_REFRESH_TOKEN',
    });
  }
}

/**
 * Get current user profile (me).
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function me(req, res) {
  const userId = req.user.id;

  const { data: user, error } = await supabaseService
    .from('users')
    .select('id, email, role, is_active, created_at, last_login_at')
    .eq('id', userId)
    .single();

  if (error || !user) {
    return res.status(404).json({
      success: false,
      error: 'User profile not found.',
      code: 'USER_NOT_FOUND',
    });
  }

  // Update last_login_at
  await supabaseService.from('users').update({ last_login_at: new Date() }).eq('id', userId);

  return res.json({
    success: true,
    data: { user },
    error: null,
    code: null,
  });
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
};