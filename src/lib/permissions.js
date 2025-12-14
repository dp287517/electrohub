// Shared permissions and app definitions
// Used by Admin panel and Dashboard

// Admin emails authorized
export const ADMIN_EMAILS = ['daniel.x.palha@haleon.com', 'palhadaniel.elec@gmail.com'];

// Available applications with routes
export const ALL_APPS = [
  { id: 'switchboards', name: 'Electrical Switchboards', icon: '⚡', category: 'Electrical', route: '/app/switchboards' },
  { id: 'obsolescence', name: 'Obsolescence', icon: '♻️', category: 'Electrical', route: '/app/obsolescence' },
  { id: 'selectivity', name: 'Selectivity', icon: '🧩', category: 'Electrical', route: '/app/selectivity' },
  { id: 'fault-level', name: 'Fault Level Assessment', icon: '📈', category: 'Electrical', route: '/app/fault-level' },
  { id: 'arc-flash', name: 'Arc Flash', icon: '⚠️', category: 'Electrical', route: '/app/arc-flash' },
  { id: 'loopcalc', name: 'Loop Calculation', icon: '🔄', category: 'Electrical', route: '/app/loopcalc' },
  { id: 'hv', name: 'High Voltage Equipment', icon: '⚡', category: 'Electrical', route: '/app/hv' },
  { id: 'diagram', name: 'Diagram', icon: '📐', category: 'Electrical', route: '/app/diagram' },
  { id: 'projects', name: 'Project', icon: '💳', category: 'Electrical', route: '/app/projects' },
  { id: 'vsd', name: 'Variable Speed Drives', icon: '⚙️', category: 'Electrical', route: '/app/vsd' },
  { id: 'meca', name: 'Mechanical Equipments', icon: '⚙️', category: 'Electrical', route: '/app/meca' },
  { id: 'oibt', name: 'OIBT', icon: '📋', category: 'Electrical', route: '/app/oibt' },
  { id: 'atex', name: 'ATEX', icon: '🧯', category: 'Utilities', route: '/app/atex' },
  { id: 'comp-ext', name: 'External Contractors', icon: '🤝', category: 'Utilities', route: '/app/comp-ext' },
  { id: 'ask-veeva', name: 'Ask Veeva', icon: '💬', category: 'Utilities', route: '/app/ask-veeva' },
  { id: 'doors', name: 'Fire Doors', icon: '🚪', category: 'Utilities', route: '/app/doors' },
  { id: 'dcf', name: 'Dcf', icon: '📊', category: 'Utilities', route: '/app/dcf' },
  { id: 'learn_ex', name: 'Formation ATEX', icon: '📊', category: 'Utilities', route: '/app/learn_ex' },
];

// Get user permissions from localStorage
export function getUserPermissions(email) {
  if (!email) return null;

  // Admins have all permissions
  if (ADMIN_EMAILS.includes(email)) {
    return {
      isAdmin: true,
      apps: ALL_APPS.map(a => a.id),
    };
  }

  // Check Haleon users (Bubble)
  const haleonUsers = JSON.parse(localStorage.getItem('eh_admin_haleon_users') || '[]');
  const haleonUser = haleonUsers.find(u => u.email?.toLowerCase() === email?.toLowerCase());
  if (haleonUser) {
    return {
      isAdmin: false,
      isHaleon: true,
      apps: haleonUser.apps || ALL_APPS.map(a => a.id),
      ...haleonUser,
    };
  }

  // Check external users
  const externalUsers = JSON.parse(localStorage.getItem('eh_admin_users') || '[]');
  const externalUser = externalUsers.find(u => u.email?.toLowerCase() === email?.toLowerCase());
  if (externalUser) {
    return {
      isAdmin: false,
      isExternal: true,
      apps: externalUser.apps || [],
      ...externalUser,
    };
  }

  // Default: all apps for unknown users (Haleon users not yet configured)
  return {
    isAdmin: false,
    apps: ALL_APPS.map(a => a.id),
  };
}

// Check if user has access to a specific app
export function hasAppAccess(email, appId) {
  const permissions = getUserPermissions(email);
  if (!permissions) return false;
  if (permissions.isAdmin) return true;
  return permissions.apps?.includes(appId) ?? false;
}

// Check if user has access to a route
export function hasRouteAccess(email, route) {
  const app = ALL_APPS.find(a => route.startsWith(a.route));
  if (!app) return true; // Allow non-app routes
  return hasAppAccess(email, app.id);
}

// Get allowed apps for a user
export function getAllowedApps(email) {
  const permissions = getUserPermissions(email);
  if (!permissions) return [];
  if (permissions.isAdmin) return ALL_APPS;
  return ALL_APPS.filter(app => permissions.apps?.includes(app.id));
}
