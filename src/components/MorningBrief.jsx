import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle, Clock, TrendingUp, ArrowRight,
  Zap, Cog, Battery, Shield, Flame, Activity, RefreshCw,
  ChevronRight, Sparkles, Building2, Calendar, Target,
  BarChart3, PieChart, Bell, ExternalLink
} from 'lucide-react';
import { Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend
} from 'chart.js';
import { aiAssistant } from '../lib/ai-assistant';

// Register Chart.js
ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Tooltip, Legend);

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
    <div className="relative w-32 h-32">
      <svg className="w-full h-full transform -rotate-90">
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
        <span className={`text-3xl font-bold ${color.text}`}>{Math.round(animatedScore)}%</span>
        <span className="text-xs text-gray-500">{status?.text || 'Santé'}</span>
      </div>
    </div>
  );
};

// Priority action card
const PriorityActionCard = ({ action, onClick }) => {
  const getUrgencyStyles = () => {
    if (action.urgency === 'high') {
      return 'bg-red-50 border-red-200 hover:bg-red-100';
    }
    if (action.urgency === 'medium') {
      return 'bg-amber-50 border-amber-200 hover:bg-amber-100';
    }
    return 'bg-blue-50 border-blue-200 hover:bg-blue-100';
  };

  return (
    <button
      onClick={onClick}
      className={`w-full p-4 rounded-xl border text-left transition-all ${getUrgencyStyles()} group`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{action.icon}</span>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-gray-900 group-hover:text-gray-700">
            {action.title}
          </h4>
          <p className="text-sm text-gray-600 mt-0.5">{action.description}</p>
        </div>
        <ChevronRight size={20} className="text-gray-400 group-hover:translate-x-1 transition-transform" />
      </div>
    </button>
  );
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
export default function MorningBrief({ userName, onClose }) {
  const navigate = useNavigate();
  const [brief, setBrief] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    loadBrief();
  }, []);

  const loadBrief = async () => {
    setIsLoading(true);
    try {
      const data = await aiAssistant.getMorningBrief();
      setBrief(data);
    } catch (error) {
      console.error('Failed to load morning brief:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleActionClick = (action) => {
    if (action.action) {
      navigate(action.action);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-3 animate-pulse">
          <RefreshCw size={24} className="animate-spin" />
          <span>Chargement du brief...</span>
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
        ticks: { font: { size: 11 } }
      }
    }
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 via-indigo-900 to-purple-900 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="p-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg">
              <Sparkles size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">
                {brief.greeting}, {userName || 'Technicien'}
              </h2>
              <p className="text-indigo-200 text-sm flex items-center gap-2">
                <Calendar size={14} />
                {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/70 hover:text-white"
          >
            {isExpanded ? 'Réduire' : 'Développer'}
          </button>
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Main Stats Grid */}
          <div className="px-6 pb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Health Score */}
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 flex items-center justify-center">
                <HealthScoreCircle score={brief.healthScore} status={brief.status} />
              </div>

              {/* Equipment Distribution Chart */}
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <h3 className="text-white/80 text-sm font-medium mb-3 flex items-center gap-2">
                  <PieChart size={14} />
                  Répartition équipements
                </h3>
                <div className="h-28">
                  <Doughnut data={equipmentChartData} options={chartOptions} />
                </div>
                <p className="text-center text-white text-lg font-bold mt-2">
                  {brief.stats?.totalEquipment || 0} <span className="text-white/60 text-sm font-normal">équipements</span>
                </p>
              </div>

              {/* Controls Status Chart */}
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <h3 className="text-white/80 text-sm font-medium mb-3 flex items-center gap-2">
                  <BarChart3 size={14} />
                  Statut contrôles
                </h3>
                <div className="h-28">
                  <Bar data={controlsChartData} options={barChartOptions} />
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats Pills */}
          <div className="px-6 pb-4">
            <div className="flex flex-wrap gap-2">
              <div className="px-3 py-1.5 bg-white/10 rounded-full text-sm text-white flex items-center gap-2">
                <Building2 size={14} className="text-indigo-300" />
                {brief.stats?.buildings || 0} bâtiments
              </div>
              <div className="px-3 py-1.5 bg-white/10 rounded-full text-sm text-white flex items-center gap-2">
                <Clock size={14} className="text-blue-300" />
                {brief.stats?.controls?.thisWeek || 0} contrôles cette semaine
              </div>
              <div className="px-3 py-1.5 bg-white/10 rounded-full text-sm text-white flex items-center gap-2">
                <CheckCircle size={14} className="text-green-300" />
                {brief.stats?.controls?.completedThisWeek || 0} complétés (7j)
              </div>
              {brief.stats?.controls?.neverControlled > 0 && (
                <div className="px-3 py-1.5 bg-amber-500/20 rounded-full text-sm text-amber-200 flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {brief.stats.controls.neverControlled} jamais contrôlés
                </div>
              )}
            </div>
          </div>

          {/* AI Insight */}
          {brief.aiInsight && (
            <div className="px-6 pb-4">
              <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-400/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-gradient-to-br from-purple-400 to-pink-400 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Sparkles size={16} className="text-white" />
                  </div>
                  <div>
                    <h4 className="text-purple-200 text-sm font-medium mb-1">Conseil Electro du jour</h4>
                    <p className="text-white text-sm leading-relaxed">{brief.aiInsight}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Priority Actions */}
          {brief.priorityActions?.length > 0 && (
            <div className="px-6 pb-6">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <Target size={16} className="text-amber-400" />
                Actions prioritaires
              </h3>
              <div className="space-y-2">
                {brief.priorityActions.map((action, index) => (
                  <PriorityActionCard
                    key={index}
                    action={action}
                    onClick={() => handleActionClick(action)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Equipment Type Breakdown */}
          <div className="px-6 pb-6">
            <h3 className="text-white/80 text-sm font-medium mb-3">Par type d'équipement</h3>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {Object.entries(brief.stats?.byType || {}).map(([type, count]) => {
                const Icon = getEquipmentIcon(type);
                return (
                  <div
                    key={type}
                    className="bg-white/5 hover:bg-white/10 rounded-lg p-3 text-center transition-colors cursor-pointer"
                    onClick={() => navigate(`/app/${type === 'switchboards' ? 'switchboards' : type}`)}
                  >
                    <Icon size={20} className="mx-auto mb-1 text-indigo-300" />
                    <p className="text-white font-semibold">{count}</p>
                    <p className="text-white/50 text-xs capitalize">{type}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Links */}
          <div className="bg-white/5 px-6 py-4 flex items-center justify-between">
            <button
              onClick={() => navigate('/app/switchboard-controls')}
              className="text-indigo-300 hover:text-white text-sm flex items-center gap-1 transition-colors"
            >
              Voir tous les contrôles
              <ExternalLink size={14} />
            </button>
            <button
              onClick={loadBrief}
              className="text-white/50 hover:text-white text-sm flex items-center gap-1 transition-colors"
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
