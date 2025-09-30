// src/App.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Index from './pages/Index.jsx';
import SignIn from './pages/SignIn.jsx';
import SignUp from './pages/SignUp.jsx';
import LostPassword from './pages/LostPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
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
import Controls from './pages/Controls.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/lost-password" element={<LostPassword />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
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
          <Route path="/app/diagram" element={<ProtectedRoute><Diagram /></ProtectedRoute>} />
          <Route path="/app/controls" element={<ProtectedRoute><Controls /></ProtectedRoute>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
