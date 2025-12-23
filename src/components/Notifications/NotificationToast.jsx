// NotificationToast.jsx
// Sleek Uber-style toast notifications
import React, { useState, useEffect } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  Bell,
  X,
  ChevronRight,
  Zap
} from 'lucide-react';

const typeConfig = {
  success: {
    icon: CheckCircle,
    bgColor: 'bg-emerald-500',
    iconColor: 'text-white',
    progressColor: 'bg-emerald-300'
  },
  error: {
    icon: XCircle,
    bgColor: 'bg-red-500',
    iconColor: 'text-white',
    progressColor: 'bg-red-300'
  },
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-amber-500',
    iconColor: 'text-white',
    progressColor: 'bg-amber-300'
  },
  info: {
    icon: Info,
    bgColor: 'bg-blue-500',
    iconColor: 'text-white',
    progressColor: 'bg-blue-300'
  },
  control: {
    icon: Zap,
    bgColor: 'bg-black dark:bg-white',
    iconColor: 'text-white dark:text-black',
    progressColor: 'bg-gray-400'
  }
};

export default function NotificationToast({
  type = 'info',
  title,
  message,
  action,
  onAction,
  onClose,
  duration = 5000,
  showProgress = true
}) {
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(100);

  const config = typeConfig[type] || typeConfig.info;
  const Icon = config.icon;

  useEffect(() => {
    if (duration <= 0) return;

    // Progress animation
    const interval = setInterval(() => {
      setProgress(prev => {
        const newProgress = prev - (100 / (duration / 50));
        return newProgress < 0 ? 0 : newProgress;
      });
    }, 50);

    return () => clearInterval(interval);
  }, [duration]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose?.();
    }, 300);
  };

  const handleAction = () => {
    onAction?.();
    handleClose();
  };

  return (
    <div
      className={`
        pointer-events-auto w-full transform transition-all duration-300 ease-out
        ${isExiting ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}
      `}
    >
      <div className="relative overflow-hidden bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800">
        {/* Progress bar */}
        {showProgress && duration > 0 && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-gray-100 dark:bg-gray-800">
            <div
              className={`h-full transition-all duration-50 ease-linear ${config.progressColor}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        <div className="flex items-start p-4 gap-3">
          {/* Icon */}
          <div className={`flex-shrink-0 w-10 h-10 ${config.bgColor} rounded-xl flex items-center justify-center shadow-lg`}>
            <Icon className={`w-5 h-5 ${config.iconColor}`} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 pt-0.5">
            <h4 className="font-semibold text-gray-900 dark:text-white text-sm">
              {title}
            </h4>
            {message && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                {message}
              </p>
            )}

            {/* Action button */}
            {action && (
              <button
                onClick={handleAction}
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-black dark:text-white
                           hover:opacity-70 transition-opacity"
              >
                {action}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={handleClose}
            className="flex-shrink-0 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Compact version for stacked notifications
export function NotificationToastCompact({
  type = 'info',
  title,
  onClose
}) {
  const [isExiting, setIsExiting] = useState(false);
  const config = typeConfig[type] || typeConfig.info;
  const Icon = config.icon;

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => onClose?.(), 200);
  };

  useEffect(() => {
    const timer = setTimeout(handleClose, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`
        pointer-events-auto inline-flex items-center gap-2 px-4 py-3
        bg-white dark:bg-gray-900 rounded-full shadow-xl border border-gray-100 dark:border-gray-800
        transform transition-all duration-200
        ${isExiting ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}
      `}
    >
      <div className={`w-6 h-6 ${config.bgColor} rounded-full flex items-center justify-center`}>
        <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
      </div>
      <span className="font-medium text-sm text-gray-900 dark:text-white">
        {title}
      </span>
    </div>
  );
}
