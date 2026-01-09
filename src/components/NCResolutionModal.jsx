// NCResolutionModal - Modal pour gérer les non-conformités après maintenance
// S'affiche automatiquement quand une maintenance a des points NC
// Photo obligatoire pour chaque NC
import { useState, useRef } from 'react';
import { X, AlertTriangle, CheckCircle, Clock, Wrench, ChevronRight, Camera, Image, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function NCResolutionModal({
  isOpen,
  onClose,
  maintenanceId,
  maintenanceName,
  equipmentData, // { id, name, code, type, building_code, floor, zone, room, original_id }
  ncItems, // [{ name, checked: false, note: '...' }, ...]
  site,
  userEmail,
  userName
}) {
  const navigate = useNavigate();
  const fileInputRefs = useRef({});

  const [resolutions, setResolutions] = useState(
    ncItems.reduce((acc, item, index) => {
      acc[index] = null; // null = not decided, 'immediate' = resolved, 'deferred' = to treat
      return acc;
    }, {})
  );
  // Photos for each NC item (base64)
  const [photos, setPhotos] = useState(
    ncItems.reduce((acc, item, index) => {
      acc[index] = null;
      return acc;
    }, {})
  );
  const [processing, setProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState('choose'); // 'choose' | 'creating'
  const [createdRecords, setCreatedRecords] = useState([]);

  if (!isOpen) return null;

  const allDecided = Object.values(resolutions).every(r => r !== null);
  const allPhotos = Object.values(photos).every(p => p !== null);
  const canConfirm = allDecided && allPhotos;
  const hasDeferred = Object.values(resolutions).some(r => r === 'deferred');

  const handleResolution = (index, resolution) => {
    setResolutions(prev => ({ ...prev, [index]: resolution }));
  };

  const handlePhotoCapture = (index) => {
    if (fileInputRefs.current[index]) {
      fileInputRefs.current[index].click();
    }
  };

  const handleFileChange = (index, event) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhotos(prev => ({ ...prev, [index]: e.target.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemovePhoto = (index) => {
    setPhotos(prev => ({ ...prev, [index]: null }));
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;

    setProcessing(true);
    setCurrentStep('creating');
    const created = [];

    try {
      // Create a troubleshooting record for each NC item
      for (let i = 0; i < ncItems.length; i++) {
        const item = ncItems[i];
        const resolution = resolutions[i];
        const photo = photos[i];

        // Determine the correct equipment ID to use
        // For numeric IDs (switchboards), use original_id; for UUIDs, use id
        const equipmentId = equipmentData.original_id || equipmentData.id;

        const troubleshootingData = {
          site,
          equipment_type: equipmentData.type || 'switchboard',
          equipment_id: equipmentId,
          equipment_name: equipmentData.name,
          equipment_code: equipmentData.code,
          building_code: equipmentData.building_code,
          floor: equipmentData.floor,
          zone: equipmentData.zone,
          room: equipmentData.room,
          title: `NC: ${item.name}`,
          description: item.note || `Point non conforme détecté lors de la maintenance: ${item.name}`,
          category: 'electrical',
          severity: 'major',
          fault_type: 'corrective',
          technician_name: userName,
          technician_email: userEmail,
          // NC specific fields
          source: 'maintenance_nc',
          source_maintenance_id: maintenanceId,
          source_nc_item: item.name,
          nc_resolution: resolution,
          priority: resolution === 'immediate' ? 'medium' : 'high',
          // Status depends on resolution
          status: resolution === 'immediate' ? 'completed' : 'in_progress',
          // If immediate, set completion time
          started_at: new Date().toISOString(),
          completed_at: resolution === 'immediate' ? new Date().toISOString() : null,
          duration_minutes: resolution === 'immediate' ? 15 : null,
          downtime_minutes: 0,
          // Pre-fill solution for immediate resolution
          solution: resolution === 'immediate' ? 'Résolu immédiatement lors de la maintenance' : null,
          root_cause: resolution === 'immediate' ? 'Détecté lors du contrôle de maintenance' : null,
          // Include photo
          photos: photo ? [{ data: photo, type: 'before', caption: `NC: ${item.name}` }] : []
        };

        const response = await fetch('/api/troubleshooting/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-site': site,
            'x-user-email': userEmail
          },
          body: JSON.stringify(troubleshootingData)
        });

        if (response.ok) {
          const result = await response.json();
          created.push({
            id: result.id,
            reportNumber: result.report_number,
            item: item.name,
            resolution
          });
        }
      }

      setCreatedRecords(created);

      // If there are deferred items, ask if user wants to go to troubleshooting dashboard
      if (!hasDeferred) {
        // All immediate - just close after a delay
        setTimeout(() => {
          onClose(created);
        }, 2000);
      }
    } catch (error) {
      console.error('Error creating NC troubleshooting records:', error);
    } finally {
      setProcessing(false);
    }
  };

  const handleGoToTroubleshooting = () => {
    // Navigate to troubleshooting list filtered by open NC
    onClose(createdRecords);
    navigate('/troubleshooting?filter=open_nc');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-red-500 p-5 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6" />
              <h2 className="text-lg font-bold">Non-Conformités Détectées</h2>
            </div>
            {currentStep === 'choose' && (
              <button
                onClick={() => onClose([])}
                className="p-1 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          <p className="text-sm text-white/80 mt-1">
            {maintenanceName || 'Maintenance'} • {ncItems.length} point{ncItems.length > 1 ? 's' : ''} NC
          </p>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto max-h-[60vh]">
          {currentStep === 'choose' ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Pour chaque point NC, prenez une photo et indiquez s'il a été résolu ou s'il nécessite un traitement ultérieur.
              </p>

              <div className="space-y-4">
                {ncItems.map((item, index) => (
                  <div
                    key={index}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      resolutions[index] === 'immediate'
                        ? 'border-green-300 bg-green-50'
                        : resolutions[index] === 'deferred'
                        ? 'border-orange-300 bg-orange-50'
                        : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <Wrench className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-gray-900">{item.name}</h4>
                        {item.note && (
                          <p className="text-sm text-gray-500 mt-1">{item.note}</p>
                        )}
                      </div>
                    </div>

                    {/* Photo capture - OBLIGATOIRE */}
                    <div className="mb-3">
                      <input
                        ref={el => fileInputRefs.current[index] = el}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => handleFileChange(index, e)}
                        className="hidden"
                      />

                      {photos[index] ? (
                        <div className="relative">
                          <img
                            src={photos[index]}
                            alt={`Photo NC ${item.name}`}
                            className="w-full h-32 object-cover rounded-lg"
                          />
                          <button
                            onClick={() => handleRemovePhoto(index)}
                            className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <div className="absolute bottom-2 left-2 px-2 py-1 bg-green-500 text-white text-xs rounded-full flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Photo OK
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => handlePhotoCapture(index)}
                          className="w-full py-4 border-2 border-dashed border-red-300 rounded-lg bg-red-50 hover:bg-red-100 transition-colors flex flex-col items-center gap-2"
                        >
                          <Camera className="w-8 h-8 text-red-500" />
                          <span className="text-sm font-medium text-red-600">
                            📸 Photo obligatoire
                          </span>
                        </button>
                      )}
                    </div>

                    {/* Resolution buttons */}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleResolution(index, 'immediate')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                          resolutions[index] === 'immediate'
                            ? 'bg-green-500 text-white'
                            : 'bg-white border border-gray-300 text-gray-700 hover:border-green-400 hover:text-green-600'
                        }`}
                      >
                        <CheckCircle className="w-4 h-4" />
                        Résolu
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolution(index, 'deferred')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                          resolutions[index] === 'deferred'
                            ? 'bg-orange-500 text-white'
                            : 'bg-white border border-gray-300 text-gray-700 hover:border-orange-400 hover:text-orange-600'
                        }`}
                      >
                        <Clock className="w-4 h-4" />
                        À traiter
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Validation message */}
              {!allPhotos && allDecided && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
                  <Camera className="w-4 h-4" />
                  Veuillez ajouter une photo pour chaque NC
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-4">
              {processing ? (
                <>
                  <div className="w-12 h-12 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-gray-600">Création des dépannages...</p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">
                    {createdRecords.length} dépannage{createdRecords.length > 1 ? 's' : ''} créé{createdRecords.length > 1 ? 's' : ''}
                  </h3>

                  <div className="text-left mt-4 space-y-2">
                    {createdRecords.map((record, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-2 p-2 rounded-lg ${
                          record.resolution === 'immediate' ? 'bg-green-50' : 'bg-orange-50'
                        }`}
                      >
                        {record.resolution === 'immediate' ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <Clock className="w-4 h-4 text-orange-500" />
                        )}
                        <span className="text-sm text-gray-700">
                          #{record.reportNumber} - {record.item}
                        </span>
                        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                          record.resolution === 'immediate'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-orange-100 text-orange-700'
                        }`}>
                          {record.resolution === 'immediate' ? 'Fermé' : 'Ouvert'}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-200">
          {currentStep === 'choose' ? (
            <div className="flex gap-3">
              <button
                onClick={() => onClose([])}
                className="flex-1 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-100 transition-colors"
              >
                Ignorer
              </button>
              <button
                onClick={handleConfirm}
                disabled={!canConfirm || processing}
                className={`flex-1 py-2.5 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                  canConfirm
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                Confirmer
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : !processing && (
            <div className="flex gap-3">
              {hasDeferred ? (
                <>
                  <button
                    onClick={() => onClose(createdRecords)}
                    className="flex-1 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-100 transition-colors"
                  >
                    Fermer
                  </button>
                  <button
                    onClick={handleGoToTroubleshooting}
                    className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-medium hover:from-orange-600 hover:to-red-600 transition-all flex items-center justify-center gap-2"
                  >
                    Voir les NC ouvertes
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => onClose(createdRecords)}
                  className="w-full py-2.5 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 transition-colors"
                >
                  Terminé
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
