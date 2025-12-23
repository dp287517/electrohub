import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle, Clock, TrendingUp, TrendingDown, ArrowRight,
  Zap, Cog, Battery, Shield, Flame, Activity, RefreshCw, Mic, MicOff,
  ChevronRight, ChevronDown, Sparkles, Building2, Calendar, Target,
  BarChart3, PieChart, Bell, BellOff, ExternalLink, Volume2, Image,
  LineChart, ArrowUpRight, ArrowDownRight, Minus
} from 'lucide-react';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { aiAssistant } from '../lib/ai-assistant';

// Register Chart.js
ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, Filler);

// Animated health score circle
const HealthScoreCircle = ({ score, status }) => {
  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedScore(score);
    }, 300);
    return () => clearTimeout(timer);
  }, [score]);

  const getColor = () => {
    if (score >= 80) return { stroke: '#22c55e', bg: 'bg-green-500', text: 'text-green-500' };
    if (score >= 60) return { stroke: '#eab308', bg: 'bg-yellow-500', text: 'text-yellow-500' };
    if (score >= 40) return { stroke: '#f97316', bg: 'bg-orange-500', text: 'text-orange-500' };
    return { stroke: '#ef4444', bg: 'bg-red-500', text: 'text-red-500' };
  };

  const color = getColor();
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (animatedScore / 100) * circumference;

  return (
    <div className="relative w-24 h-24 sm:w-32 sm:h-32">
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 128 128">
        <circle
          cx="64"
          cy="64"
          r="45"
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="8"
        />
        <circle
          cx="64"
          cy="64"
          r="45"
          fill="none"
          stroke={color.stroke}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl sm:text-3xl font-bold ${color.text}`}>{Math.round(animatedScore)}%</span>
        <span className="text-[10px] sm:text-xs text-gray-500">{status?.text || 'Santé'}</span>
      </div>
    </div>
  );
};

// Suggestion Card
const SuggestionCard = ({ suggestion, onClick }) => {
  const typeStyles = {
    urgent: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    tip: 'bg-green-50 border-green-200 text-green-800'
  };

  return (
    <button
      onClick={onClick}
      className={`w-full p-3 rounded-lg border text-left transition-all hover:shadow-md ${typeStyles[suggestion.type] || typeStyles.info}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg">{suggestion.icon}</span>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm">{suggestion.title}</h4>
          <p className="text-xs opacity-80 mt-0.5 line-clamp-2">{suggestion.message}</p>
        </div>
        <ChevronRight size={16} className="flex-shrink-0 mt-0.5" />
      </div>
    </button>
  );
};

// Historical trend chart
const TrendChart = ({ data, period }) => {
  if (!data) return null;

  // Simplify labels for display
  const displayLabels = data.labels.map((d, i) => {
    if (period <= 7) return new Date(d).toLocaleDateString('fr-FR', { weekday: 'short' });
    if (i % Math.ceil(data.labels.length / 7) === 0) {
      return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    }
    return '';
  });

  const chartData = {
    labels: displayLabels,
    datasets: [
      {
        label: 'Contrôles complétés',
        data: data.datasets.controlsCompleted,
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4
      },
      {
        label: 'NC créées',
        data: data.datasets.ncCreated,
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        fill: false,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(0,0,0,0.8)',
        titleFont: { size: 11 },
        bodyFont: { size: 10 },
        padding: 8
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 9 }, color: 'rgba(255,255,255,0.5)' }
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.1)' },
        ticks: { font: { size: 9 }, color: 'rgba(255,255,255,0.5)' }
      }
    }
  };

  return <Line data={chartData} options={options} />;
};

// Equipment type icon
const getEquipmentIcon = (type) => {
  const icons = {
    switchboards: Zap,
    vsd: Cog,
    meca: Cog,
    atex: Flame,
    hv: Zap,
    glo: Battery
  };
  return icons[type] || Zap;
};

// Main MorningBrief component
export default function MorningBrief({ userName }) {
  const navigate = useNavigate();
  const [brief, setBrief] = useState(null);
  const [historical, setHistorical] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showHistorical, setShowHistorical] = useState(false);
  const [period, setPeriod] = useState(30);
  const [notificationsEnabled, setNotificationsEnabled] = useState(Notification?.permission === 'granted');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (showHistorical) {
      loadHistorical();
    }
  }, [showHistorical, period]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [briefData, suggestionsData] = await Promise.all([
        aiAssistant.getMorningBrief(),
        aiAssistant.getSuggestions()
      ]);
      setBrief(briefData);
      setSuggestions(suggestionsData?.suggestions || []);
    } catch (error) {
      console.error('Failed to load morning brief:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadHistorical = async () => {
    const data = await aiAssistant.getHistoricalStats(period);
    if (data?.success) {
      setHistorical(data);
    }
  };

  const handleSuggestionClick = (suggestion) => {
    if (suggestion.action?.type === 'navigate') {
      navigate(suggestion.action.path);
    } else if (suggestion.action?.type === 'command') {
      // Handle commands
      aiAssistant.executeAction(suggestion.action.command, {});
    }
  };

  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
    } else {
      const granted = await aiAssistant.requestNotificationPermission();
      if (granted) {
        setNotificationsEnabled(true);
        aiAssistant.scheduleMorningBrief();
      }
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 rounded-2xl p-4 sm:p-6 text-white">
        <div className="flex items-center gap-3 animate-pulse">
          <RefreshCw size={24} className="animate-spin" />
          <span className="text-sm sm:text-base">Chargement du brief...</span>
        </div>
      </div>
    );
  }

  if (!brief) return null;

  // Chart data for equipment distribution
  const equipmentChartData = {
    labels: brief.charts?.equipmentDistribution?.map(d => d.name) || [],
    datasets: [{
      data: brief.charts?.equipmentDistribution?.map(d => d.value) || [],
      backgroundColor: brief.charts?.equipmentDistribution?.map(d => d.color) || [],
      borderWidth: 0,
      hoverOffset: 4
    }]
  };

  // Chart data for controls status
  const controlsChartData = {
    labels: brief.charts?.controlsStatus?.map(d => d.name) || [],
    datasets: [{
      data: brief.charts?.controlsStatus?.map(d => d.value) || [],
      backgroundColor: brief.charts?.controlsStatus?.map(d => d.color) || [],
      borderRadius: 8,
      borderSkipped: false
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    }
  };

  const barChartOptions = {
    ...chartOptions,
    indexAxis: 'y',
    scales: {
      x: { display: false },
      y: {
        grid: { display: false },
        ticks: { font: { size: 10 }, color: 'rgba(255,255,255,0.7)' }
      }
    }
  };

  const TrendIcon = historical?.summary?.trend === 'up' ? TrendingUp :
                    historical?.summary?.trend === 'down' ? TrendingDown : Minus;

  return (
    <div className="bg-gradient-to-br from-slate-900 via-indigo-900 to-purple-900 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="p-4 sm:p-6 pb-3 sm:pb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
              <Sparkles size={20} className="text-white sm:hidden" />
              <Sparkles size={24} className="text-white hidden sm:block" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-2xl font-bold text-white truncate">
                {brief.greeting}, {userName || 'Technicien'}
              </h2>
              <p className="text-indigo-200 text-xs sm:text-sm flex items-center gap-1 sm:gap-2">
                <Calendar size={12} className="sm:hidden" />
                <Calendar size={14} className="hidden sm:block" />
                <span className="truncate">
                  {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <button
              onClick={toggleNotifications}
              className={`p-2 rounded-lg transition-colors ${notificationsEnabled ? 'bg-green-500/20 text-green-300' : 'bg-white/10 text-white/50'} hover:bg-white/20`}
              title={notificationsEnabled ? 'Notifications activées' : 'Activer les notifications'}
            >
              {notificationsEnabled ? <Bell size={16} /> : <BellOff size={16} />}
            </button>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/70 hover:text-white"
            >
              <ChevronDown size={20} className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Main Stats Grid */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {/* Health Score */}
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 sm:p-4 flex items-center justify-center">
                <HealthScoreCircle score={brief.healthScore} status={brief.status} />
              </div>

              {/* Equipment Distribution Chart */}
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 sm:p-4">
                <h3 className="text-white/80 text-xs sm:text-sm font-medium mb-2 sm:mb-3 flex items-center gap-2">
                  <PieChart size={14} />
                  Équipements
                </h3>
                <div className="h-20 sm:h-28">
                  <Doughnut data={equipmentChartData} options={chartOptions} />
                </div>
                <p className="text-center text-white text-base sm:text-lg font-bold mt-2">
                  {brief.stats?.totalEquipment || 0} <span className="text-white/60 text-xs sm:text-sm font-normal">total</span>
                </p>
              </div>

              {/* Controls Status Chart */}
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 sm:p-4">
                <h3 className="text-white/80 text-xs sm:text-sm font-medium mb-2 sm:mb-3 flex items-center gap-2">
                  <BarChart3 size={14} />
                  Contrôles
                </h3>
                <div className="h-20 sm:h-28">
                  <Bar data={controlsChartData} options={barChartOptions} />
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats Pills */}
          <div className="px-4 sm:px-6 pb-3 sm:pb-4">
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-white/10 rounded-full text-xs sm:text-sm text-white flex items-center gap-1 sm:gap-2">
                <Building2 size={12} className="text-indigo-300 sm:hidden" />
                <Building2 size={14} className="text-indigo-300 hidden sm:block" />
                {brief.stats?.buildings || 0} bâtiments
              </div>
              <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-white/10 rounded-full text-xs sm:text-sm text-white flex items-center gap-1 sm:gap-2">
                <Clock size={12} className="text-blue-300 sm:hidden" />
                <Clock size={14} className="text-blue-300 hidden sm:block" />
                {brief.stats?.controls?.thisWeek || 0} cette semaine
              </div>
              <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-white/10 rounded-full text-xs sm:text-sm text-white flex items-center gap-1 sm:gap-2">
                <CheckCircle size={12} className="text-green-300 sm:hidden" />
                <CheckCircle size={14} className="text-green-300 hidden sm:block" />
                {brief.stats?.controls?.completedThisWeek || 0} complétés
              </div>
              {(brief.stats?.controls?.neverControlled || 0) > 0 && (
                <div className="px-2 sm:px-3 py-1 sm:py-1.5 bg-amber-500/20 rounded-full text-xs sm:text-sm text-amber-200 flex items-center gap-1 sm:gap-2">
                  <AlertTriangle size={12} className="sm:hidden" />
                  <AlertTriangle size={14} className="hidden sm:block" />
                  {brief.stats.controls.neverControlled} jamais contrôlés
                </div>
              )}
            </div>
          </div>

          {/* AI Insight */}
          {brief.aiInsight && (
            <div className="px-4 sm:px-6 pb-3 sm:pb-4">
              <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-400/30 rounded-xl p-3 sm:p-4">
                <div className="flex items-start gap-2 sm:gap-3">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-purple-400 to-pink-400 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Sparkles size={14} className="text-white sm:hidden" />
                    <Sparkles size={16} className="text-white hidden sm:block" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-purple-200 text-xs sm:text-sm font-medium mb-1">Conseil Electro</h4>
                    <p className="text-white text-xs sm:text-sm leading-relaxed">{brief.aiInsight}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Historical Trends Toggle */}
          <div className="px-4 sm:px-6 pb-3 sm:pb-4">
            <button
              onClick={() => setShowHistorical(!showHistorical)}
              className="w-full flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors"
            >
              <div className="flex items-center gap-2">
                <LineChart size={16} className="text-indigo-300" />
                <span className="text-white text-sm font-medium">Tendances historiques</span>
              </div>
              <ChevronDown size={16} className={`text-white/50 transform transition-transform ${showHistorical ? 'rotate-180' : ''}`} />
            </button>

            {showHistorical && (
              <div className="mt-3 bg-white/5 rounded-xl p-3 sm:p-4">
                {/* Period selector */}
                <div className="flex gap-2 mb-3">
                  {[7, 30, 90].map(p => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        period === p ? 'bg-indigo-500 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
                      }`}
                    >
                      {p}j
                    </button>
                  ))}
                </div>

                {/* Chart */}
                <div className="h-32 sm:h-40">
                  <TrendChart data={historical} period={period} />
                </div>

                {/* Summary */}
                {historical?.summary && (
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                    <div className="text-xs text-white/60">
                      <span className="text-white font-medium">{historical.summary.totalControlsCompleted}</span> contrôles complétés
                    </div>
                    <div className={`flex items-center gap-1 text-xs ${
                      historical.summary.trend === 'up' ? 'text-green-400' :
                      historical.summary.trend === 'down' ? 'text-red-400' : 'text-white/60'
                    }`}>
                      <TrendIcon size={14} />
                      <span>
                        {historical.summary.trend === 'up' ? 'En hausse' :
                         historical.summary.trend === 'down' ? 'En baisse' : 'Stable'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Proactive Suggestions */}
          {suggestions.length > 0 && (
            <div className="px-4 sm:px-6 pb-4 sm:pb-6">
              <h3 className="text-white font-semibold mb-2 sm:mb-3 flex items-center gap-2 text-sm sm:text-base">
                <Target size={14} className="text-amber-400 sm:hidden" />
                <Target size={16} className="text-amber-400 hidden sm:block" />
                Suggestions
              </h3>
              <div className="space-y-2">
                {suggestions.slice(0, 3).map((suggestion, index) => (
                  <SuggestionCard
                    key={index}
                    suggestion={suggestion}
                    onClick={() => handleSuggestionClick(suggestion)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Equipment Type Breakdown */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            <h3 className="text-white/80 text-xs sm:text-sm font-medium mb-2 sm:mb-3">Par type</h3>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-2">
              {Object.entries(brief.stats?.byType || {}).map(([type, count]) => {
                const Icon = getEquipmentIcon(type);
                return (
                  <div
                    key={type}
                    className="bg-white/5 hover:bg-white/10 rounded-lg p-2 sm:p-3 text-center transition-colors cursor-pointer"
                    onClick={() => navigate(`/app/${type === 'switchboards' ? 'switchboards' : type}`)}
                  >
                    <Icon size={16} className="mx-auto mb-1 text-indigo-300 sm:hidden" />
                    <Icon size={20} className="mx-auto mb-1 text-indigo-300 hidden sm:block" />
                    <p className="text-white font-semibold text-sm sm:text-base">{count}</p>
                    <p className="text-white/50 text-[10px] sm:text-xs capitalize truncate">{type}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Links */}
          <div className="bg-white/5 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
            <button
              onClick={() => navigate('/app/switchboard-controls')}
              className="text-indigo-300 hover:text-white text-xs sm:text-sm flex items-center gap-1 transition-colors"
            >
              Voir tous les contrôles
              <ExternalLink size={12} className="sm:hidden" />
              <ExternalLink size={14} className="hidden sm:block" />
            </button>
            <button
              onClick={loadData}
              className="text-white/50 hover:text-white text-xs sm:text-sm flex items-center gap-1 transition-colors"
            >
              <RefreshCw size={12} className="sm:hidden" />
              <RefreshCw size={14} className="hidden sm:block" />
              Actualiser
            </button>
          </div>
        </>
      )}
    </div>
  );
}
