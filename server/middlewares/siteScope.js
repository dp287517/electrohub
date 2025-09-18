export function siteScope(req, _res, next){
  const site = req.user?.site || req.headers['x-site'] || 'Default';
  req.site = String(site);
  next();
}
