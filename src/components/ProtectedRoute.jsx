import { Navigate, useLocation } from 'react-router-dom';
import { hasRouteAccess } from '../lib/permissions';

export default function ProtectedRoute({ children }) {
  const token = localStorage.getItem('eh_token');
  const location = useLocation();

  // Not authenticated - redirect to signin
  if (!token) {
    return <Navigate to="/signin" replace />;
  }

  // Check route access permissions
  const user = JSON.parse(localStorage.getItem('eh_user') || '{}');

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
