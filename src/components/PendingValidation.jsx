import { useNavigate } from 'react-router-dom';
import { Clock, Shield, Mail, ArrowLeft } from 'lucide-react';

/**
 * Component shown to users who are pending admin validation
 * They cannot access any application until validated
 */
export default function PendingValidation({ user }) {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('eh_token');
    localStorage.removeItem('eh_user');
    localStorage.removeItem('bubble_token');
    window.location.href = 'https://haleon-tool.io';
  };

  const handleRefresh = () => {
    // Force re-check of validation status
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-amber-100 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-8 text-center">
            <div className="w-20 h-20 bg-white/20 backdrop-blur rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock size={40} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">En attente de validation</h1>
            <p className="text-amber-100 mt-2">Votre compte est en cours de vérification</p>
          </div>

          {/* Content */}
          <div className="px-6 py-8 space-y-6">
            {/* User info */}
            <div className="bg-gray-50 rounded-xl p-4 flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                <span className="text-xl font-bold text-amber-600">
                  {user?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
              <div>
                <p className="font-medium text-gray-900">{user?.name || 'Utilisateur'}</p>
                <p className="text-sm text-gray-500">{user?.email}</p>
              </div>
            </div>

            {/* Explanation */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Shield size={20} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-gray-900">Validation de sécurité requise</p>
                  <p className="text-sm text-gray-600 mt-1">
                    Pour des raisons de sécurité, tous les nouveaux utilisateurs doivent être validés
                    par un administrateur avant de pouvoir accéder aux applications.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Mail size={20} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-gray-900">L'administrateur a été notifié</p>
                  <p className="text-sm text-gray-600 mt-1">
                    Un administrateur examinera votre demande d'accès et configurera vos permissions.
                    Vous recevrez un email une fois votre compte validé.
                  </p>
                </div>
              </div>
            </div>

            {/* Progress indicator */}
            <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
                </div>
                <div>
                  <p className="text-sm font-medium text-amber-800">Validation en cours...</p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Cette page se rafraîchira automatiquement une fois votre compte validé
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 space-y-3">
            <button
              onClick={handleRefresh}
              className="w-full py-3 px-4 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-xl transition-colors"
            >
              Vérifier mon statut
            </button>
            <button
              onClick={handleLogout}
              className="w-full py-3 px-4 bg-white hover:bg-gray-100 text-gray-700 font-medium rounded-xl border border-gray-200 transition-colors flex items-center justify-center gap-2"
            >
              <ArrowLeft size={18} />
              Retour à haleon-tool.io
            </button>
          </div>
        </div>

        {/* Footer text */}
        <p className="text-center text-sm text-gray-500 mt-6">
          Besoin d'aide ? Contactez votre administrateur ElectroHub
        </p>
      </div>
    </div>
  );
}
