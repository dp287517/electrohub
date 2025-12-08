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
import Oibt from './pages/Oibt.jsx';
import Project from './pages/Project.jsx';
import Comp from './pages/Comp.jsx';
import AskVeeva from './pages/Ask_veeva.jsx';
import Doors from './pages/Doors.jsx';
import Dcf from './pages/Dcf.jsx';
import LearnEx from './pages/Learn_ex.jsx';
import SwitchboardDiagram from './pages/SwitchboardDiagram';
import SwitchboardDiagram from './pages/Switchboard_map';

// 👇 NEW: VSD (Variateurs de fréquence)
import Vsd from './pages/Vsd.jsx';
import Meca from './pages/Meca.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Routes>
          {/* Public */}
          <Route path="/" element={<Index />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/lost-password" element={<LostPassword />} />

          {/* Dashboard */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {/* Apps existantes */}
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
          <Route path="/app/oibt" element={<ProtectedRoute><Oibt /></ProtectedRoute>} />
          <Route path="/app/projects" element={<ProtectedRoute><Project /></ProtectedRoute>} />
          <Route path="/app/comp-ext" element={<ProtectedRoute><Comp /></ProtectedRoute>} />
          <Route path="/app/ask-veeva" element={<ProtectedRoute><AskVeeva /></ProtectedRoute>} />
          <Route path="/app/doors" element={<ProtectedRoute><Doors /></ProtectedRoute>} />
          <Route path="/app/meca" element={<ProtectedRoute><Meca /></ProtectedRoute>} />
          <Route path="/app/dcf" element={<ProtectedRoute><Dcf /></ProtectedRoute>} />
          <Route
            path="/app/switchboards/:id/diagram"
            element={
              <ProtectedRoute>
                <SwitchboardDiagram />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/switchboards/:id/map"
            element={
              <ProtectedRoute>
                <Switchboardmap />
              </ProtectedRoute>
            }
          />

          {/* 👇 NEW: Variable Speed Drives */}
          <Route path="/app/vsd" element={<ProtectedRoute><Vsd /></ProtectedRoute>} />
          <Route path="/app/learn_ex" element={<ProtectedRoute><LearnEx /></ProtectedRoute>} />
          

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
