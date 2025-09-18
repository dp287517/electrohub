import jwt from 'jsonwebtoken';

export function authOptional(req, _res, next){
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token){
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev');
    } catch {
      req.user = null;
    }
  }
  next();
}
