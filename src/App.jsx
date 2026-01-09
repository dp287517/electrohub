// src/App.jsx
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import SignIn from './pages/SignIn.jsx';
import SignUp from './pages/SignUp.jsx';
import LostPassword from './pages/LostPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Admin from './pages/Admin.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

import Atex from './pages/Atex.jsx';
import LoopCalc from './pages/LoopCalc.jsx';
import Switchboards from './pages/Switchboards.jsx';
import Selectivity from './pages/Selectivity.jsx';
import FaultLevelAssessment from './pages/Fault_level_assessment.jsx';
import ArcFlash from './pages/Arc_flash.jsx';
import Obsolescence from './pages/Obsolescence.jsx';
import HighVoltage from './pages/High_voltage.jsx';
import Diagram from './pages/Diagram.jsx';
import SwitchboardControls from './pages/SwitchboardControls.jsx';
import SwitchboardControlsMap from './pages/SwitchboardControls_map.jsx';
import Oibt from './pages/Oibt.jsx';
import Project from './pages/Project.jsx';
import Comp from './pages/Comp.jsx';
import AskVeeva from './pages/Ask_veeva.jsx';
import Doors from './pages/Doors.jsx';
import DoorsMap from './pages/Doors_map.jsx';
import Dcf from './pages/Dcf.jsx';
import LearnEx from './pages/Learn_ex.jsx';
import SwitchboardDiagram from './pages/SwitchboardDiagram.jsx';
import SwitchboardMap from './pages/Switchboard_map.jsx';
import Vsd from './pages/Vsd.jsx';
import VsdMap from './pages/Vsd_map.jsx';
import Meca from './pages/Meca.jsx';
import MecaMap from './pages/Meca_map.jsx';
import MobileEquipments from './pages/MobileEquipments.jsx';
import MobileEquipmentsMap from './pages/MobileEquipments_map.jsx';
import HighVoltageMap from './pages/High_voltage_map.jsx';
import Glo from './pages/Glo.jsx';
import GloMap from './pages/Glo_map.jsx';
import Datahub from './pages/Datahub.jsx';
import DatahubMap from './pages/Datahub_map.jsx';
import Infrastructure from './pages/Infrastructure.jsx';
import InfrastructureMap from './pages/Infrastructure_map.jsx';
import CustomModule from './pages/CustomModule.jsx';
import CustomModuleMap from './pages/CustomModule_map.jsx';
import Procedures from './pages/Procedures.jsx';
import FireControl from './pages/FireControl.jsx';
import FireControlMap from './pages/FireControl_map.jsx';
import TroubleshootingDashboard from './pages/TroubleshootingDashboard.jsx';
import TroubleshootingDetail from './pages/TroubleshootingDetail.jsx';
import SharedTroubleshootingView from './pages/SharedTroubleshootingView.jsx';
// FloatingAssistant removed from global - now only in Dashboard for mobile

// Component to redirect authenticated users to dashboard
function AuthRedirect({ children }) {
  const token = localStorage.getItem('eh_token');
  if (token) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

export default function App() {
  const location = useLocation();

  // Hide navbar for public shared views
  const hideNavbar = location.pathname.startsWith('/shared/');

  return (
    <div className="min-h-screen bg-gray-50">
      {!hideNavbar && <Navbar />}
      <div className={hideNavbar ? '' : 'max-w-[95vw] mx-auto px-4 py-6'}>
        <Routes>
          {/* Public - redirect to dashboard if already logged in */}
          <Route path="/" element={<AuthRedirect><SignIn /></AuthRedirect>} />
          <Route path="/signin" element={<AuthRedirect><SignIn /></AuthRedirect>} />
          <Route path="/signup" element={<AuthRedirect><SignUp /></AuthRedirect>} />
          <Route path="/lost-password" element={<LostPassword />} />

          {/* Public - Shared Troubleshooting View (no auth required) */}
          <Route path="/shared/troubleshooting/:token" element={<SharedTroubleshootingView />} />

          {/* Dashboard */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {/* Admin Panel */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <Admin />
              </ProtectedRoute>
            }
          />

          {/* Apps */}
          <Route path="/app/atex" element={<ProtectedRoute><Atex /></ProtectedRoute>} />
          <Route path="/app/loopcalc" element={<ProtectedRoute><LoopCalc /></ProtectedRoute>} />
          <Route path="/app/switchboards" element={<ProtectedRoute><Switchboards /></ProtectedRoute>} />
          <Route path="/app/selectivity" element={<ProtectedRoute><Selectivity /></ProtectedRoute>} />
          <Route path="/app/fault-level" element={<ProtectedRoute><FaultLevelAssessment /></ProtectedRoute>} />
          <Route path="/app/arc-flash" element={<ProtectedRoute><ArcFlash /></ProtectedRoute>} />
          <Route path="/app/obsolescence" element={<ProtectedRoute><Obsolescence /></ProtectedRoute>} />
          <Route path="/app/hv" element={<ProtectedRoute><HighVoltage /></ProtectedRoute>} />
          <Route path="/app/hv/map" element={<ProtectedRoute><HighVoltageMap /></ProtectedRoute>} />
          <Route path="/app/diagram" element={<ProtectedRoute><Diagram /></ProtectedRoute>} />
          <Route path="/app/switchboard-controls" element={<ProtectedRoute><SwitchboardControls /></ProtectedRoute>} />
          <Route path="/app/switchboard-controls/map" element={<ProtectedRoute><SwitchboardControlsMap /></ProtectedRoute>} />
          <Route path="/app/oibt" element={<ProtectedRoute><Oibt /></ProtectedRoute>} />
          <Route path="/app/projects" element={<ProtectedRoute><Project /></ProtectedRoute>} />
          <Route path="/app/comp-ext" element={<ProtectedRoute><Comp /></ProtectedRoute>} />
          <Route path="/app/ask-veeva" element={<ProtectedRoute><AskVeeva /></ProtectedRoute>} />
          <Route path="/app/doors" element={<ProtectedRoute><Doors /></ProtectedRoute>} />
          <Route path="/app/doors/map" element={<ProtectedRoute><DoorsMap /></ProtectedRoute>} />
          <Route path="/app/meca" element={<ProtectedRoute><Meca /></ProtectedRoute>} />
          <Route path="/app/dcf" element={<ProtectedRoute><Dcf /></ProtectedRoute>} />
          <Route path="/app/switchboards/:id/diagram" element={<ProtectedRoute><SwitchboardDiagram /></ProtectedRoute>} />
          <Route path="/app/switchboards/map" element={<ProtectedRoute><SwitchboardMap /></ProtectedRoute>} />
          <Route path="/app/vsd" element={<ProtectedRoute><Vsd /></ProtectedRoute>} />
          <Route path="/app/vsd/map" element={<ProtectedRoute><VsdMap /></ProtectedRoute>} />
          <Route path="/app/meca/map" element={<ProtectedRoute><MecaMap /></ProtectedRoute>} />
          <Route path="/app/learn_ex" element={<ProtectedRoute><LearnEx /></ProtectedRoute>} />
          <Route path="/app/mobile-equipments" element={<ProtectedRoute><MobileEquipments /></ProtectedRoute>} />
          <Route path="/app/mobile-equipments/map" element={<ProtectedRoute><MobileEquipmentsMap /></ProtectedRoute>} />
          <Route path="/app/glo" element={<ProtectedRoute><Glo /></ProtectedRoute>} />
          <Route path="/app/glo/map" element={<ProtectedRoute><GloMap /></ProtectedRoute>} />
          <Route path="/app/datahub" element={<ProtectedRoute><Datahub /></ProtectedRoute>} />
          <Route path="/app/datahub/map" element={<ProtectedRoute><DatahubMap /></ProtectedRoute>} />
          <Route path="/app/procedures" element={<ProtectedRoute><Procedures /></ProtectedRoute>} />
          <Route path="/app/fire-control" element={<ProtectedRoute><FireControl /></ProtectedRoute>} />
          <Route path="/app/fire-control/map" element={<ProtectedRoute><FireControlMap /></ProtectedRoute>} />
          <Route path="/app/troubleshooting" element={<ProtectedRoute><TroubleshootingDashboard /></ProtectedRoute>} />
          <Route path="/app/troubleshooting/:id" element={<ProtectedRoute><TroubleshootingDetail /></ProtectedRoute>} />
          <Route path="/app/infrastructure" element={<ProtectedRoute><Infrastructure /></ProtectedRoute>} />
          <Route path="/app/infrastructure/map" element={<ProtectedRoute><InfrastructureMap /></ProtectedRoute>} />

          {/* Dynamic Custom Modules (created by admins) */}
          <Route path="/app/m/:slug" element={<ProtectedRoute><CustomModule /></ProtectedRoute>} />
          <Route path="/app/m/:slug/map" element={<ProtectedRoute><CustomModuleMap /></ProtectedRoute>} />

          {/* Fallback - redirect to signin */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
