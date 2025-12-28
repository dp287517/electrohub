import { Navigate, useLocation } from 'react-router-dom';
import { hasRouteAccess, getUserPermissions } from '../lib/permissions';
import PendingValidation from './PendingValidation';

export default function ProtectedRoute({ children }) {
  const token = localStorage.getItem('eh_token');
  const location = useLocation();

  // Not authenticated - redirect to haleon-tool.io for authentication
  if (!token) {
    // Clear any stale data
    localStorage.removeItem('eh_user');
    localStorage.removeItem('bubble_token');
    // Redirect to haleon-tool.io for proper authentication
    window.location.href = 'https://haleon-tool.io';
    return null;
  }

  // Check route access permissions
  const user = JSON.parse(localStorage.getItem('eh_user') || '{}');
  const permissions = getUserPermissions(user?.email);

  // Check if user is pending validation
  if (permissions?.isPending || user?.isPending || user?.is_validated === false) {
    // Allow access to dashboard only (to show pending status)
    // But show PendingValidation component for all other routes
    if (location.pathname === '/dashboard') {
      return <PendingValidation user={user} />;
    }
    // For app routes, also show pending
    return <PendingValidation user={user} />;
  }

  // Skip permission check for dashboard and admin routes
  if (location.pathname === '/dashboard' || location.pathname === '/admin') {
    return children;
  }

  // Check if user has access to this app route
  if (!hasRouteAccess(user?.email, location.pathname)) {
    // Redirect to dashboard with access denied
    return <Navigate to="/dashboard" replace state={{ accessDenied: true }} />;
  }

  return children;
}
