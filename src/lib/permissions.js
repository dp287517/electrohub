// Shared permissions and app definitions
// Used by Admin panel and Dashboard

// Admin emails authorized
export const ADMIN_EMAILS = ['daniel.x.palha@haleon.com', 'palhadaniel.elec@gmail.com'];

// Available applications with routes
export const ALL_APPS = [
  { id: 'switchboards', name: 'Electrical Switchboards', icon: '⚡', category: 'Electrical', route: '/app/switchboards' },
  { id: 'switchboard-controls', name: 'Contrôles Périodiques', icon: '📋', category: 'Electrical', route: '/app/switchboard-controls' },
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
  { id: 'fire-control', name: 'Contrôle Asservissements Incendie', icon: '🔥', category: 'Utilities', route: '/app/fire-control' },
  { id: 'dcf', name: 'Dcf', icon: '📊', category: 'Utilities', route: '/app/dcf' },
  { id: 'learn_ex', name: 'Formation ATEX', icon: '📊', category: 'Utilities', route: '/app/learn_ex' },
  { id: 'mobile-equipments', name: 'Mobile Equipments', icon: '🔌', category: 'Electrical', route: '/app/mobile-equipments' },
  { id: 'glo', name: 'Global Electrical Equipments', icon: '🔋', category: 'Electrical', route: '/app/glo' },
  { id: 'datahub', name: 'Datahub', icon: '🗄️', category: 'Electrical', route: '/app/datahub' },
  { id: 'procedures', name: 'Operational Procedures', icon: '📋', category: 'Utilities', route: '/app/procedures' },
];

// Get user permissions from localStorage
export function getUserPermissions(email) {
  if (!email) return null;

  // Admins have all permissions (case-insensitive check)
  const emailLower = email.toLowerCase();
  if (ADMIN_EMAILS.some(adminEmail => adminEmail.toLowerCase() === emailLower)) {
    return {
      isAdmin: true,
      isPending: false,
      isValidated: true,
      apps: ALL_APPS.map(a => a.id),
    };
  }

  // Check logged-in user data (from JWT/login)
  // This is the most reliable source
  try {
    const loggedInUser = JSON.parse(localStorage.getItem('eh_user') || '{}');
    if (loggedInUser?.email?.toLowerCase() === email?.toLowerCase()) {

      // Check if user is pending validation
      if (loggedInUser.is_validated === false || loggedInUser.isPending === true) {
        return {
          isAdmin: false,
          isPending: true,
          isValidated: false,
          apps: [], // No access until validated
          ...loggedInUser,
        };
      }

      // External user logged in - use their allowed_apps from JWT
      if (loggedInUser.allowed_apps && Array.isArray(loggedInUser.allowed_apps)) {
        return {
          isAdmin: loggedInUser.role === 'admin' || loggedInUser.role === 'superadmin',
          isExternal: loggedInUser.source === 'local' || loggedInUser.origin === 'external',
          isPending: false,
          isValidated: true,
          apps: loggedInUser.allowed_apps,
          role: loggedInUser.role,
          ...loggedInUser,
        };
      }

      // Haleon/Bubble user - must be validated to have access
      if (loggedInUser.source === 'bubble') {
        // Only give full access if explicitly validated
        if (loggedInUser.is_validated === true) {
          return {
            isAdmin: false,
            isHaleon: true,
            isPending: false,
            isValidated: true,
            apps: loggedInUser.allowed_apps || ALL_APPS.map(a => a.id),
            ...loggedInUser,
          };
        }
        // Not validated = pending
        return {
          isAdmin: false,
          isHaleon: true,
          isPending: true,
          isValidated: false,
          apps: [],
          ...loggedInUser,
        };
      }
    }
  } catch (e) {
    console.warn('[permissions] Error reading eh_user:', e);
  }

  // Check Haleon users (Bubble) from admin cache
  const haleonUsers = JSON.parse(localStorage.getItem('eh_admin_haleon_users') || '[]');
  const haleonUser = haleonUsers.find(u => u.email?.toLowerCase() === email?.toLowerCase());
  if (haleonUser) {
    // Only validated users get access
    if (haleonUser.is_validated === true) {
      return {
        isAdmin: false,
        isHaleon: true,
        isPending: false,
        isValidated: true,
        apps: haleonUser.apps || haleonUser.allowed_apps || ALL_APPS.map(a => a.id),
        ...haleonUser,
      };
    }
    return {
      isAdmin: false,
      isHaleon: true,
      isPending: true,
      isValidated: false,
      apps: [],
      ...haleonUser,
    };
  }

  // Check external users from admin cache
  const externalUsers = JSON.parse(localStorage.getItem('eh_admin_users') || '[]');
  const externalUser = externalUsers.find(u => u.email?.toLowerCase() === email?.toLowerCase());
  if (externalUser) {
    return {
      isAdmin: false,
      isExternal: true,
      isPending: false,
      isValidated: true,
      apps: externalUser.apps || externalUser.allowed_apps || [],
      ...externalUser,
    };
  }

  // SECURITY: Unknown users get NO access - must be validated by admin
  return {
    isAdmin: false,
    isPending: true,
    isValidated: false,
    apps: [],
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
