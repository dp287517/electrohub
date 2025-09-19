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
import LoopCalc from './pages/LoopCalc.jsx'; // <-- AJOUT

export default function App() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/lost-password" element={<LostPassword />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/app/atex" element={<ProtectedRoute><Atex /></ProtectedRoute>} />
        <Route path="/app/loopcalc" element={<ProtectedRoute><LoopCalc /></ProtectedRoute>} /> {/* <-- AJOUT */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
