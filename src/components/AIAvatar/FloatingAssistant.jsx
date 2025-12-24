import { useState, useEffect, useCallback } from 'react';
import { AnimatedAvatar, AVATAR_STYLES } from './AnimatedAvatar';
import AvatarChat from './AvatarChat';
import AvatarSelector from './AvatarSelector';
import { X, Sparkles, AlertTriangle, Calendar, Bell } from 'lucide-react';
import { aiAssistant } from '../../lib/ai-assistant';

/**
 * FloatingAssistant - Bouton flottant pour accéder à l'assistant IA depuis n'importe quelle page
 * Apparaît en bas à droite et peut afficher des notifications proactives
 */
export default function FloatingAssistant() {
  const token = localStorage.getItem('eh_token');

  const [avatarStyle, setAvatarStyle] = useState(() => {
    const saved = localStorage.getItem('eh_avatar_style');
    // Migration des anciens styles vers les nouveaux
    if (saved && !AVATAR_STYLES[saved]) {
      localStorage.setItem('eh_avatar_style', 'ai');
      return 'ai';
    }
    return saved || 'ai';
  });
  const [showChat, setShowChat] = useState(false);
  const [showSelector, setShowSelector] = useState(false);
  const [notification, setNotification] = useState(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
  const [hasSeenNotification, setHasSeenNotification] = useState(false);

  // Sauvegarder le style d'avatar
  useEffect(() => {
    localStorage.setItem('eh_avatar_style', avatarStyle);
  }, [avatarStyle]);

  // Vérifier périodiquement s'il y a des alertes à afficher
  const checkForAlerts = useCallback(async () => {
    if (!token || hasSeenNotification) return;

    try {
      const context = await aiAssistant.getGlobalContext();

      // Vérifier s'il y a des contrôles en retard
      if (context.overdueControls > 0) {
        setNotification({
          type: 'alert',
          icon: AlertTriangle,
          title: 'Contrôles en retard',
          message: `Vous avez ${context.overdueControls} contrôle(s) en retard`,
          action: 'Voir les détails'
        });
        setIsPulsing(true);
        return;
      }

      // Vérifier s'il y a des contrôles à venir cette semaine
      if (context.upcomingControls > 3) {
        setNotification({
          type: 'info',
          icon: Calendar,
          title: 'Contrôles à venir',
          message: `${context.upcomingControls} contrôles programmés`,
          action: 'Planifier'
        });
        setIsPulsing(true);
        return;
      }

    } catch (error) {
      // Silently fail
    }
  }, [token, hasSeenNotification]);

  // Vérifier les alertes au montage et toutes les 5 minutes
  useEffect(() => {
    if (!token) return;

    // Vérifier après 10 secondes (laisser la page charger)
    const initialTimeout = setTimeout(checkForAlerts, 10000);

    // Puis vérifier toutes les 5 minutes
    const interval = setInterval(checkForAlerts, 5 * 60 * 1000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [checkForAlerts, token]);

  // Ne pas afficher si pas connecté
  if (!token) return null;

  const avatar = AVATAR_STYLES[avatarStyle] || AVATAR_STYLES.electro;

  const handleNotificationClick = () => {
    setHasSeenNotification(true);
    setNotification(null);
    setIsPulsing(false);
    setShowChat(true);
  };

  const dismissNotification = (e) => {
    e.stopPropagation();
    setHasSeenNotification(true);
    setNotification(null);
    setIsPulsing(false);
  };

  return (
    <>
      {/* Floating Button */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
        {/* Notification Bubble */}
        {notification && !showChat && (
          <div
            onClick={handleNotificationClick}
            className={`
              max-w-xs bg-white rounded-2xl shadow-2xl border p-4 cursor-pointer
              transform transition-all duration-300 ease-out
              hover:scale-105 hover:shadow-3xl
              ${notification.type === 'alert' ? 'border-red-200' : 'border-brand-200'}
            `}
          >
            <button
              onClick={dismissNotification}
              className="absolute top-2 right-2 p-1 hover:bg-gray-100 rounded-full"
            >
              <X className="w-3 h-3 text-gray-400" />
            </button>

            <div className="flex items-start gap-3">
              <div className={`
                p-2 rounded-xl
                ${notification.type === 'alert' ? 'bg-red-100' : 'bg-brand-100'}
              `}>
                <notification.icon className={`
                  w-5 h-5
                  ${notification.type === 'alert' ? 'text-red-600' : 'text-brand-600'}
                `} />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 text-sm">
                  {notification.title}
                </p>
                <p className="text-gray-600 text-xs mt-0.5">
                  {notification.message}
                </p>
                <button className="text-brand-600 text-xs font-medium mt-2 hover:underline">
                  {notification.action} →
                </button>
              </div>
            </div>

            {/* Arrow pointing to avatar */}
            <div className="absolute -bottom-2 right-8 w-4 h-4 bg-white border-b border-r border-gray-200 transform rotate-45" />
          </div>
        )}

        {/* Main Avatar Button */}
        <button
          onClick={() => setShowChat(true)}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`
            relative p-2 rounded-full bg-white shadow-2xl border border-gray-200
            transition-all duration-300 ease-out
            hover:scale-110 hover:shadow-3xl
            ${isPulsing ? 'animate-pulse' : ''}
          `}
          title={`Parler à ${avatar.name}`}
        >
          <AnimatedAvatar
            style={avatarStyle}
            size="md"
            speaking={isHovered}
          />

          {/* Status indicator */}
          <span className="absolute bottom-1 right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full flex items-center justify-center">
            {isPulsing ? (
              <Bell className="w-2 h-2 text-white animate-bounce" />
            ) : (
              <Sparkles className="w-2 h-2 text-white" />
            )}
          </span>

          {/* Ripple effect on pulse */}
          {isPulsing && (
            <span className="absolute inset-0 rounded-full bg-brand-500 animate-ping opacity-25" />
          )}
        </button>

        {/* Label on hover */}
        {isHovered && !notification && !showChat && (
          <div className="absolute bottom-full right-0 mb-2 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg shadow-lg whitespace-nowrap">
            Parler à {avatar.name}
            <div className="absolute -bottom-1 right-6 w-2 h-2 bg-gray-900 rotate-45" />
          </div>
        )}
      </div>

      {/* Chat Modal */}
      <AvatarChat
        isOpen={showChat}
        onClose={() => setShowChat(false)}
        avatarStyle={avatarStyle}
        onChangeAvatar={() => {
          setShowChat(false);
          setShowSelector(true);
        }}
      />

      {/* Avatar Selector Modal */}
      {showSelector && (
        <AvatarSelector
          currentStyle={avatarStyle}
          onSelect={(style) => {
            setAvatarStyle(style);
            setShowSelector(false);
          }}
          onClose={() => setShowSelector(false)}
        />
      )}
    </>
  );
}
