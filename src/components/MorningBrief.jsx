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

// Animated health score circle - Clean design
const HealthScoreCircle = ({ score, status }) => {
  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedScore(score);
    }, 300);
    return () => clearTimeout(timer);
  }, [score]);

  const getColor = () => {
    if (score >= 80) return { stroke: '#10b981', bg: 'bg-emerald-500', text: 'text-emerald-600', label: 'Excellent' };
    if (score >= 60) return { stroke: '#f59e0b', bg: 'bg-amber-500', text: 'text-amber-600', label: 'Attention' };
    if (score >= 40) return { stroke: '#f97316', bg: 'bg-orange-500', text: 'text-orange-600', label: 'À surveiller' };
    return { stroke: '#ef4444', bg: 'bg-red-500', text: 'text-red-600', label: 'Critique' };
  };

  const color = getColor();
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (animatedScore / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28 sm:w-32 sm:h-32">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="#f1f5f9"
            strokeWidth="6"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={color.stroke}
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-3xl sm:text-4xl font-bold ${color.text}`}>{Math.round(animatedScore)}</span>
          <span className="text-xs text-slate-500 font-medium">/ 100</span>
        </div>
      </div>
      <div className={`mt-2 px-3 py-1 rounded-full text-xs font-medium ${color.bg} text-white`}>
        {color.label}
      </div>
    </div>
  );
};

// Clean Suggestion Card
const SuggestionCard = ({ suggestion, onClick }) => {
  const typeStyles = {
    urgent: 'border-l-4 border-l-red-500 bg-red-50',
    warning: 'border-l-4 border-l-amber-500 bg-amber-50',
    info: 'border-l-4 border-l-blue-500 bg-blue-50',
    tip: 'border-l-4 border-l-emerald-500 bg-emerald-50'
  };

  const textStyles = {
    urgent: 'text-red-900',
    warning: 'text-amber-900',
    info: 'text-blue-900',
    tip: 'text-emerald-900'
  };

  return (
    <button
      onClick={onClick}
      className={`w-full p-3 sm:p-4 rounded-lg text-left transition-all hover:shadow-md ${typeStyles[suggestion.type] || typeStyles.info}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0">{suggestion.icon}</span>
        <div className="flex-1 min-w-0">
          <h4 className={`font-semibold text-sm ${textStyles[suggestion.type] || textStyles.info}`}>{suggestion.title}</h4>
          <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{suggestion.message}</p>
        </div>
        <ChevronRight size={16} className="flex-shrink-0 mt-0.5 text-slate-400" />
      </div>
    </button>
  );
};

// Clean Historical trend chart
const TrendChart = ({ data, period }) => {
  if (!data) return null;

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
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 2,
        pointBackgroundColor: '#10b981',
        pointHoverRadius: 5
      },
      {
        label: 'NC créées',
        data: data.datasets.ncCreated,
        borderColor: '#ef4444',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.4,
        pointRadius: 2,
        pointBackgroundColor: '#ef4444',
        pointHoverRadius: 5,
        borderDash: [5, 5]
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
        backgroundColor: 'white',
        titleColor: '#1e293b',
        bodyColor: '#475569',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        titleFont: { size: 12, weight: '600' },
        bodyFont: { size: 11 },
        padding: 10,
        cornerRadius: 8,
        boxPadding: 4
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 10 }, color: '#94a3b8' }
      },
      y: {
        grid: { color: '#f1f5f9' },
        ticks: { font: { size: 10 }, color: '#94a3b8' },
        beginAtZero: true
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

// Stat Card Component
const StatCard = ({ icon: Icon, value, label, color = 'blue', onClick }) => (
  <button
    onClick={onClick}
    className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all text-left w-full"
  >
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg bg-${color}-50 flex items-center justify-center`}>
        <Icon size={20} className={`text-${color}-600`} />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  </button>
);

// Main MorningBrief component - Clean Design
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
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-3 animate-pulse">
          <RefreshCw size={20} className="animate-spin text-slate-400" />
          <span className="text-slate-500">Chargement du brief...</span>
        </div>
      </div>
    );
  }

  if (!brief) return null;

  // Clean chart colors
  const equipmentColors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

  const equipmentChartData = {
    labels: brief.charts?.equipmentDistribution?.map(d => d.name) || [],
    datasets: [{
      data: brief.charts?.equipmentDistribution?.map(d => d.value) || [],
      backgroundColor: equipmentColors.slice(0, brief.charts?.equipmentDistribution?.length || 0),
      borderWidth: 0,
      hoverOffset: 8
    }]
  };

  const controlsChartData = {
    labels: ['En retard', 'Cette semaine', 'Conformes'],
    datasets: [{
      data: [
        brief.stats?.controls?.overdue || 0,
        brief.stats?.controls?.thisWeek || 0,
        brief.stats?.controls?.completedThisWeek || 0
      ],
      backgroundColor: ['#ef4444', '#f59e0b', '#10b981'],
      borderRadius: 6,
      borderSkipped: false
    }]
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'white',
        titleColor: '#1e293b',
        bodyColor: '#475569',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 10
      }
    }
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'white',
        titleColor: '#1e293b',
        bodyColor: '#475569',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        cornerRadius: 8
      }
    },
    scales: {
      x: { display: false, beginAtZero: true },
      y: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: '#64748b' }
      }
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header - Clean */}
      <div className="p-4 sm:p-6 border-b border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
              <Sparkles size={24} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">
                {brief.greeting}, {userName || 'Technicien'}
              </h2>
              <p className="text-slate-500 text-sm flex items-center gap-2">
                <Calendar size={14} />
                <span className="truncate">
                  {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={toggleNotifications}
              className={`p-2 rounded-lg transition-colors ${
                notificationsEnabled
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
              }`}
              title={notificationsEnabled ? 'Notifications activées' : 'Activer les notifications'}
            >
              {notificationsEnabled ? <Bell size={18} /> : <BellOff size={18} />}
            </button>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
            >
              <ChevronDown size={20} className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Main Stats Row */}
          <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Health Score */}
            <div className="bg-slate-50 rounded-xl p-4 sm:p-6 flex flex-col items-center justify-center">
              <p className="text-sm text-slate-500 mb-3 font-medium">Score de santé</p>
              <HealthScoreCircle score={brief.healthScore} status={brief.status} />
            </div>

            {/* Equipment Distribution */}
            <div className="bg-slate-50 rounded-xl p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-slate-500 font-medium">Équipements</p>
                <span className="text-xl font-bold text-slate-900">{brief.stats?.totalEquipment || 0}</span>
              </div>
              <div className="h-32 sm:h-36">
                <Doughnut data={equipmentChartData} options={doughnutOptions} />
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                {brief.charts?.equipmentDistribution?.slice(0, 4).map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: equipmentColors[i] }} />
                    <span className="text-slate-600">{item.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Controls Status */}
            <div className="bg-slate-50 rounded-xl p-4 sm:p-6">
              <p className="text-sm text-slate-500 font-medium mb-4">Statut des contrôles</p>
              <div className="h-32 sm:h-36">
                <Bar data={controlsChartData} options={barOptions} />
              </div>
              <div className="flex justify-center gap-4 mt-3">
                <div className="flex items-center gap-1.5 text-xs">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-slate-600">Retard</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-slate-600">Semaine</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-slate-600">Fait</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium">
                <Building2 size={14} />
                {brief.stats?.buildings || 0} bâtiments
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium">
                <Clock size={14} />
                {brief.stats?.controls?.thisWeek || 0} contrôles cette semaine
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium">
                <CheckCircle size={14} />
                {brief.stats?.controls?.completedThisWeek || 0} complétés
              </div>
              {(brief.stats?.controls?.overdue || 0) > 0 && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-sm font-medium">
                  <AlertTriangle size={14} />
                  {brief.stats.controls.overdue} en retard
                </div>
              )}
            </div>
          </div>

          {/* AI Insight */}
          {brief.aiInsight && (
            <div className="px-4 sm:px-6 pb-4 sm:pb-6">
              <div className="bg-gradient-to-r from-blue-50 to-slate-50 border border-blue-100 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Sparkles size={16} className="text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-blue-800 text-sm font-semibold mb-1">Conseil du jour</h4>
                    <p className="text-slate-700 text-sm leading-relaxed">{brief.aiInsight}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Historical Trends */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            <button
              onClick={() => setShowHistorical(!showHistorical)}
              className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <div className="flex items-center gap-2">
                <LineChart size={18} className="text-slate-600" />
                <span className="text-slate-700 font-medium">Tendances historiques</span>
              </div>
              <ChevronDown size={18} className={`text-slate-400 transform transition-transform ${showHistorical ? 'rotate-180' : ''}`} />
            </button>

            {showHistorical && (
              <div className="mt-3 bg-slate-50 rounded-xl p-4">
                {/* Period selector */}
                <div className="flex gap-2 mb-4">
                  {[7, 30, 90].map(p => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        period === p
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                      }`}
                    >
                      {p} jours
                    </button>
                  ))}
                </div>

                {/* Legend */}
                <div className="flex gap-4 mb-3">
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-3 h-0.5 bg-emerald-500 rounded" />
                    <span className="text-slate-600">Contrôles complétés</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-3 h-0.5 bg-red-500 rounded border-dashed" style={{ borderStyle: 'dashed' }} />
                    <span className="text-slate-600">NC créées</span>
                  </div>
                </div>

                {/* Chart */}
                <div className="h-40 sm:h-48 bg-white rounded-lg p-3 border border-slate-100">
                  <TrendChart data={historical} period={period} />
                </div>

                {/* Summary */}
                {historical?.summary && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
                    <div className="text-sm text-slate-600">
                      <span className="font-semibold text-slate-900">{historical.summary.totalControlsCompleted}</span> contrôles sur {period}j
                    </div>
                    <div className={`flex items-center gap-1.5 text-sm font-medium ${
                      historical.summary.trend === 'up' ? 'text-emerald-600' :
                      historical.summary.trend === 'down' ? 'text-red-600' : 'text-slate-500'
                    }`}>
                      {historical.summary.trend === 'up' ? <TrendingUp size={16} /> :
                       historical.summary.trend === 'down' ? <TrendingDown size={16} /> : <Minus size={16} />}
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
              <h3 className="text-slate-900 font-semibold mb-3 flex items-center gap-2">
                <Target size={16} className="text-amber-500" />
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

          {/* Equipment Type Grid */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            <h3 className="text-slate-500 text-sm font-medium mb-3">Par type d'équipement</h3>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {Object.entries(brief.stats?.byType || {}).map(([type, count]) => {
                const Icon = getEquipmentIcon(type);
                return (
                  <button
                    key={type}
                    className="bg-slate-50 hover:bg-slate-100 rounded-xl p-3 text-center transition-all hover:shadow-sm"
                    onClick={() => navigate(`/app/${type === 'switchboards' ? 'switchboards' : type}`)}
                  >
                    <Icon size={20} className="mx-auto mb-1.5 text-slate-400" />
                    <p className="text-slate-900 font-bold text-lg">{count}</p>
                    <p className="text-slate-500 text-xs capitalize truncate">{type}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-slate-50 border-t border-slate-100 px-4 sm:px-6 py-3 flex items-center justify-between">
            <button
              onClick={() => navigate('/app/switchboard-controls')}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1.5 transition-colors"
            >
              Voir tous les contrôles
              <ExternalLink size={14} />
            </button>
            <button
              onClick={loadData}
              className="text-slate-500 hover:text-slate-700 text-sm flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw size={14} />
              Actualiser
            </button>
          </div>
        </>
      )}
    </div>
  );
}
