// src/components/AIAvatar/MiniSwitchboardPreview.jsx
// Mini preview of switchboard/equipment location for AI chat responses
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MapPin, Zap, Building2, Layers, ExternalLink,
  Maximize2, ChevronRight, X, Calendar, AlertTriangle,
  CheckCircle, Clock
} from 'lucide-react';
import { api, API_BASE } from '../../lib/api.js';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// PDF.js config
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * MiniSwitchboardPreview - Shows a mini floor plan preview with switchboard location
 *
 * @param {object} equipment - Equipment data with switchboard info
 * @param {number} switchboardId - Direct switchboard ID (optional)
 * @param {object} controlStatus - Control status info (optional)
 * @param {function} onNavigate - Callback when user wants to view full map
 */
export default function MiniSwitchboardPreview({
  equipment,
  switchboardId,
  controlStatus,
  onNavigate,
  className = ''
}) {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [planData, setPlanData] = useState(null);
  const [position, setPosition] = useState(null);
  const [switchboard, setSwitchboard] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Get switchboard ID from props or equipment
  const sbId = switchboardId || equipment?.switchboard_id || equipment?.id;

  // Fetch switchboard position and plan data
  useEffect(() => {
    if (!sbId) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        // 1. Get switchboard details
        const sbResponse = await api.get(`/api/switchboard/boards/${sbId}`);
        if (sbResponse.data) {
          setSwitchboard(sbResponse.data);
        }

        // 2. Get placement info
        const placedResponse = await api.get('/api/switchboard-map/placed-ids');
        const placedDetails = placedResponse.data?.placed_details || {};
        const placement = placedDetails[sbId];

        if (!placement) {
          setError('not_placed');
          setLoading(false);
          return;
        }

        // 3. Get position data
        const posResponse = await api.get('/api/switchboard/maps/positions', {
          params: {
            logical_name: placement.logical_name,
            page_index: placement.page_index || 0
          }
        });

        const positions = posResponse.data || [];
        const myPosition = positions.find(p => p.switchboard_id === sbId);

        if (myPosition) {
          setPosition(myPosition);
          setPlanData({
            logical_name: placement.logical_name,
            display_name: placement.display_name || placement.logical_name,
            page_index: placement.page_index || 0
          });
        } else {
          setError('position_not_found');
        }
      } catch (err) {
        console.error('[MiniPreview] Error:', err);
        setError('fetch_error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [sbId]);

  // Render PDF preview with marker
  const renderPreview = useCallback(async () => {
    if (!planData || !position || !canvasRef.current) return;

    try {
      const pdfUrl = `${API_BASE}/api/switchboard/maps/planFile?logical_name=${encodeURIComponent(planData.logical_name)}`;
      const pdf = await pdfjsLib.getDocument({
        url: pdfUrl,
        withCredentials: true
      }).promise;

      const page = await pdf.getPage((planData.page_index || 0) + 1);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      // Small preview size
      const targetWidth = isExpanded ? 600 : 280;
      const viewport = page.getViewport({ scale: 1 });
      const scale = targetWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;

      // Render PDF
      await page.render({
        canvasContext: ctx,
        viewport: scaledViewport
      }).promise;

      // Draw marker at position
      const markerX = position.x_frac * canvas.width;
      const markerY = position.y_frac * canvas.height;
      const markerSize = isExpanded ? 20 : 12;

      // Marker shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;

      // Marker circle with pulsing effect
      const isOverdue = controlStatus?.hasOverdue;
      const gradient = ctx.createRadialGradient(
        markerX, markerY, 0,
        markerX, markerY, markerSize
      );

      if (isOverdue) {
        gradient.addColorStop(0, '#ef4444');
        gradient.addColorStop(1, '#dc2626');
      } else {
        gradient.addColorStop(0, '#f59e0b');
        gradient.addColorStop(1, '#d97706');
      }

      ctx.beginPath();
      ctx.arc(markerX, markerY, markerSize, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // White border
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Lightning icon in center
      ctx.fillStyle = 'white';
      ctx.font = `bold ${isExpanded ? 14 : 8}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡', markerX, markerY);

    } catch (err) {
      console.error('[MiniPreview] Render error:', err);
      setError('render_error');
    }
  }, [planData, position, isExpanded, controlStatus]);

  // Render when data is ready
  useEffect(() => {
    if (planData && position) {
      renderPreview();
    }
  }, [planData, position, renderPreview]);

  // Handle navigation to full map
  const handleViewFullMap = () => {
    if (onNavigate) {
      onNavigate(sbId, planData);
    } else {
      // Navigate to switchboard map with this switchboard selected
      navigate(`/switchboard-map?switchboard=${sbId}&plan=${encodeURIComponent(planData?.logical_name || '')}`);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className={`bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200 overflow-hidden ${className}`}>
        <div className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-200 rounded-lg animate-pulse" />
          <div className="flex-1">
            <div className="h-4 bg-slate-200 rounded w-32 mb-2 animate-pulse" />
            <div className="h-3 bg-slate-200 rounded w-24 animate-pulse" />
          </div>
        </div>
        <div className="h-32 bg-slate-200 animate-pulse" />
      </div>
    );
  }

  // Not placed or error state
  if (error === 'not_placed' || !sbId) {
    return (
      <div className={`bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <div className="p-2 bg-slate-200 rounded-lg">
            <MapPin className="w-5 h-5 text-slate-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Position non définie</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Cet équipement n'est pas encore placé sur un plan.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Render error
  if (error) {
    return (
      <div className={`bg-gradient-to-br from-red-50 to-red-100 rounded-xl border border-red-200 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <div className="p-2 bg-red-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-red-700">Erreur de chargement</p>
            <p className="text-xs text-red-500 mt-0.5">
              Impossible de charger le plan.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Success - render mini map preview
  return (
    <>
      <div className={`bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow ${className}`}>
        {/* Header with location info */}
        <div className="p-3 border-b border-amber-200/50 bg-white/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg shadow-sm">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {switchboard?.name || switchboard?.code || `Tableau #${sbId}`}
                </p>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {switchboard?.meta?.building_code && (
                    <span className="flex items-center gap-0.5">
                      <Building2 className="w-3 h-3" />
                      {switchboard.meta.building_code}
                    </span>
                  )}
                  {switchboard?.meta?.floor && (
                    <span className="flex items-center gap-0.5">
                      <Layers className="w-3 h-3" />
                      {switchboard.meta.floor}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Control status badge */}
            {controlStatus && (
              <div className={`px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${
                controlStatus.hasOverdue
                  ? 'bg-red-100 text-red-700'
                  : controlStatus.nextDueDate && new Date(controlStatus.nextDueDate) < new Date(Date.now() + 30*24*60*60*1000)
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-green-100 text-green-700'
              }`}>
                {controlStatus.hasOverdue ? (
                  <>
                    <AlertTriangle className="w-3 h-3" />
                    Retard
                  </>
                ) : controlStatus.nextDueDate ? (
                  <>
                    <Calendar className="w-3 h-3" />
                    {new Date(controlStatus.nextDueDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-3 h-3" />
                    OK
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Mini map canvas */}
        <div className="relative bg-white cursor-pointer group" onClick={() => setIsExpanded(true)}>
          <canvas
            ref={canvasRef}
            className="w-full h-auto max-h-40 object-contain"
            style={{ display: 'block' }}
          />

          {/* Overlay with expand hint */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <div className="px-3 py-1.5 bg-white/90 backdrop-blur-sm rounded-full shadow-lg flex items-center gap-2">
              <Maximize2 className="w-4 h-4 text-slate-600" />
              <span className="text-sm font-medium text-slate-700">Agrandir</span>
            </div>
          </div>

          {/* Plan name badge */}
          <div className="absolute bottom-2 left-2 px-2 py-1 bg-white/90 backdrop-blur-sm rounded-lg text-xs text-slate-600 shadow-sm">
            📍 {planData?.display_name || planData?.logical_name}
          </div>
        </div>

        {/* Action footer */}
        <div className="p-2 border-t border-amber-200/50 bg-white/50">
          <button
            onClick={handleViewFullMap}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg text-sm font-medium transition-all shadow-sm hover:shadow"
          >
            <MapPin className="w-4 h-4" />
            Voir sur le plan complet
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded Modal */}
      {isExpanded && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-amber-50 to-orange-50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl shadow-sm">
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">
                    {switchboard?.name || `Tableau #${sbId}`}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {planData?.display_name || planData?.logical_name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsExpanded(false)}
                className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {/* Modal Content - Large Map */}
            <div className="p-4 bg-slate-50">
              <canvas
                ref={(el) => {
                  if (el && canvasRef.current !== el) {
                    canvasRef.current = el;
                    renderPreview();
                  }
                }}
                className="w-full h-auto max-h-[60vh] object-contain rounded-xl border border-slate-200 shadow-inner"
                style={{ display: 'block' }}
              />
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between p-4 border-t bg-white">
              <div className="flex items-center gap-4 text-sm text-slate-500">
                {switchboard?.meta?.building_code && (
                  <span className="flex items-center gap-1">
                    <Building2 className="w-4 h-4" />
                    {switchboard.meta.building_code}
                  </span>
                )}
                {switchboard?.meta?.floor && (
                  <span className="flex items-center gap-1">
                    <Layers className="w-4 h-4" />
                    Étage {switchboard.meta.floor}
                  </span>
                )}
                {switchboard?.meta?.room && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {switchboard.meta.room}
                  </span>
                )}
              </div>
              <button
                onClick={handleViewFullMap}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-medium transition-all shadow-sm hover:shadow"
              >
                <ExternalLink className="w-4 h-4" />
                Ouvrir dans l'éditeur de plans
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
