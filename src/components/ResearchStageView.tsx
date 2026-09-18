import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Sparkles,
  ArrowRight,
  Plus,
  Trash2,
  Save,
  Calendar,
  User,
  Hash,
  Bookmark,
  BookOpen,
  ShieldAlert,
  Search,
  RefreshCw,
  Clock,
  Layers,
  Check,
  FileQuestion,
  Info
} from 'lucide-react';
import {
  ResearchResult,
  ResearchFact,
  ResearchDate,
  ResearchName,
  ResearchNumber,
  ResearchEvent,
  ResearchClaim,
  ResearchSource,
  ResearchUncertaintyFlag,
  ResearchOpenQuestion,
  ResearchStatus,
  VideoProject,
} from '../types.js';

interface ResearchStageViewProps {
  project: VideoProject;
  onProceedToScript: () => void;
  onRunFullPipeline?: () => void;
  isLoading: boolean;
  onUpdateProject: (updates: Partial<VideoProject>) => void;
}

type StatusFilter = 'all' | 'verified' | 'needs_review' | 'uncertain';
type EntityTab = 'all' | 'facts' | 'numbers' | 'dates' | 'names' | 'events' | 'claims' | 'uncertainties' | 'questions' | 'sources';

export const ResearchStageView: React.FC<ResearchStageViewProps> = ({
  project,
  onProceedToScript,
  isLoading,
  onUpdateProject,
}) => {
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [isFetchingResearch, setIsFetchingResearch] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [activeEntityTab, setActiveEntityTab] = useState<EntityTab>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<boolean>(false);

  // User notes and sources state
  const [userNotes, setUserNotes] = useState<string>(project.userResearchNotes || '');
  const [userProvidedSources, setUserProvidedSources] = useState<string>(project.userProvidedSources || '');

  // Fetch research data from server
  React.useEffect(() => {
    let isMounted = true;

    async function loadResearch() {
      setIsFetchingResearch(true);
      try {
        const res = await fetch(`/api/projects/${project.id}/research`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            if (data.research) {
              setResearch(data.research);
              setUserNotes(data.research.userNotes || data.userResearchNotes || '');
              setUserProvidedSources(data.research.userProvidedSources || data.userProvidedSources || '');
            } else {
              // No research compiled yet, auto-trigger creation
              triggerGenerateResearch();
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch research dossier:', err);
      } finally {
        if (isMounted) setIsFetchingResearch(false);
      }
    }

    loadResearch();
    return () => {
      isMounted = false;
    };
  }, [project.id]);

  // Trigger AI generation of research
  const triggerGenerateResearch = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/generate-research`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setResearch(data.research);
        setUserNotes(data.research.userNotes || '');
        setUserProvidedSources(data.research.userProvidedSources || '');
        onUpdateProject({
          researchStatus: data.research.status || 'needs_review',
          researchSummary: data.research.summary,
        });
      }
    } catch (err) {
      console.error('Failed to generate research:', err);
    } finally {
      setIsGenerating(false);
      setIsFetchingResearch(false);
    }
  };

  // Save current research updates to server
  const saveResearchToServer = async (updatedData: ResearchResult, showToast = true) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/research`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedData),
      });
      if (res.ok) {
        const data = await res.json();
        setResearch(data.research);
        onUpdateProject({
          researchStatus: data.research.status,
          researchSummary: data.research.summary,
          userResearchNotes: data.research.userNotes,
          userProvidedSources: data.research.userProvidedSources,
        });
        if (showToast) {
          setSaveSuccessNotice(true);
          setTimeout(() => setSaveSuccessNotice(false), 3000);
        }
      }
    } catch (err) {
      console.error('Failed to save research notes:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Status counters
  const counts = useMemo(() => {
    if (!research) return { verified: 0, needsReview: 0, uncertain: 0, total: 0 };

    let verified = 0;
    let needsReview = 0;
    let uncertain = 0;

    const items = [
      ...(research.facts || []),
      ...(research.dates || []),
      ...(research.names || []),
      ...(research.numbers || []),
      ...(research.events || []),
      ...(research.claims || []),
    ];

    items.forEach((item) => {
      if (item.status === 'verified') verified++;
      else if (item.status === 'uncertain') uncertain++;
      else needsReview++;
    });

    return {
      verified,
      needsReview,
      uncertain,
      total: items.length,
    };
  }, [research]);

  // Item status toggle helper
  const updateItemStatus = (
    collection: 'facts' | 'dates' | 'names' | 'numbers' | 'events' | 'claims',
    id: string,
    newStatus: 'verified' | 'needs_review' | 'uncertain'
  ) => {
    if (!research) return;
    const updatedCollection = ((research[collection] as any[]) || []).map((item) => {
      if (item.id === id) {
        return { ...item, status: newStatus };
      }
      return item;
    });

    const updatedResearch: ResearchResult = {
      ...research,
      [collection]: updatedCollection,
    };
    setResearch(updatedResearch);
    saveResearchToServer(updatedResearch, false);
  };

  // Approve research and proceed
  const handleApproveAndProceed = async () => {
    if (!research) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/research/approve`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setResearch(data.research);
        onUpdateProject({
          researchStatus: 'approved',
        });
        onProceedToScript();
      }
    } catch (err) {
      console.error('Failed to approve research:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Filter items helper
  const matchesFilter = (status: string, text: string) => {
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    if (searchQuery.trim() && !text.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  };

  if (isFetchingResearch && !research) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-500/10 text-rose-400 mb-4 animate-pulse">
          <BookOpen className="w-8 h-8 animate-spin" />
        </div>
        <h2 className="text-xl font-semibold text-slate-100">Compiling Research Dossier</h2>
        <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
          Analyzing &ldquo;{project.topic}&rdquo; to extract structured facts, timelines, figures, metrics, and claims...
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header & Stage Overview */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5" />
                Stage 1: Ground Truth & Research
              </span>

              {/* Research Status Badge */}
              <span
                id="research-status-badge"
                className={`px-3 py-1 text-xs font-medium rounded-full border flex items-center gap-1.5 ${
                  research?.status === 'approved'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : research?.status === 'uncertain'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                }`}
              >
                {research?.status === 'approved' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5" />
                )}
                Status: {research?.status === 'approved' ? 'Approved by User' : research?.status === 'uncertain' ? 'Requires Fact-Checking' : 'Needs Review'}
              </span>
            </div>

            <h1 className="text-2xl font-bold text-white tracking-tight">
              {project.topic}
            </h1>
            <p className="text-sm text-slate-400 max-w-3xl">
              {research?.summary || 'Review and verify key claims, verified facts, and dates before scriptwriting begins. Generated claims are not assumed to be verified facts.'}
            </p>
          </div>

          {/* Top Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              id="refresh-research-btn"
              onClick={triggerGenerateResearch}
              disabled={isGenerating || isLoading}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm font-medium flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin text-rose-400' : ''}`} />
              Re-analyze Research
            </button>

            <button
              id="approve-and-generate-script-btn"
              onClick={handleApproveAndProceed}
              disabled={isSaving || isGenerating || isLoading}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-sm font-semibold shadow-lg shadow-rose-950/50 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              Approve & Generate Script
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Verification Status Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-800/80">
          <div
            onClick={() => setStatusFilter('all')}
            className={`p-3 rounded-xl border cursor-pointer transition-all ${
              statusFilter === 'all'
                ? 'bg-slate-800/80 border-slate-600 shadow'
                : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800/40'
            }`}
          >
            <div className="text-xs text-slate-400 font-medium">Total Entities</div>
            <div className="text-2xl font-bold text-white mt-0.5">{counts.total}</div>
          </div>

          <div
            id="filter-verified-card"
            onClick={() => setStatusFilter('verified')}
            className={`p-3 rounded-xl border cursor-pointer transition-all ${
              statusFilter === 'verified'
                ? 'bg-emerald-950/40 border-emerald-500/60 shadow'
                : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800/40'
            }`}
          >
            <div className="text-xs text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Verified / Supported
            </div>
            <div className="text-2xl font-bold text-emerald-300 mt-0.5">{counts.verified}</div>
          </div>

          <div
            id="filter-needs-review-card"
            onClick={() => setStatusFilter('needs_review')}
            className={`p-3 rounded-xl border cursor-pointer transition-all ${
              statusFilter === 'needs_review'
                ? 'bg-indigo-950/40 border-indigo-500/60 shadow'
                : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800/40'
            }`}
          >
            <div className="text-xs text-indigo-400 font-medium flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Needs Review
            </div>
            <div className="text-2xl font-bold text-indigo-300 mt-0.5">{counts.needsReview}</div>
          </div>

          <div
            id="filter-uncertain-card"
            onClick={() => setStatusFilter('uncertain')}
            className={`p-3 rounded-xl border cursor-pointer transition-all ${
              statusFilter === 'uncertain'
                ? 'bg-amber-950/40 border-amber-500/60 shadow'
                : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800/40'
            }`}
          >
            <div className="text-xs text-amber-400 font-medium flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5" />
              Uncertain
            </div>
            <div className="text-2xl font-bold text-amber-300 mt-0.5">{counts.uncertain}</div>
          </div>
        </div>
      </div>

      {/* Integrity Notice */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex items-start gap-3.5 text-xs text-slate-300">
        <Info className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold text-slate-200">
            Fact-Checking Guardrail: AI-generated claims are not assumed to be verified facts.
          </p>
          <p className="text-slate-400 leading-relaxed">
            All facts, metrics, and claims begin in &ldquo;Needs Review&rdquo; or &ldquo;Uncertain&rdquo;. The &ldquo;Verified&rdquo; badge is only assigned once you confirm or provide supportive documentation. Approved research directly steers the script generator.
          </p>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Structured Research Review */}
        <div className="lg:col-span-2 space-y-6">
          {/* Controls Bar: Entity Tabs & Search */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
            {/* Horizontal Entity Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 scrollbar-none">
              {(
                [
                  { id: 'all', label: 'All Items' },
                  { id: 'facts', label: `Facts (${research?.facts?.length || 0})` },
                  { id: 'numbers', label: `Numbers (${research?.numbers?.length || 0})` },
                  { id: 'dates', label: `Dates (${research?.dates?.length || 0})` },
                  { id: 'names', label: `People (${research?.names?.length || 0})` },
                  { id: 'claims', label: `Claims (${research?.claims?.length || 0})` },
                  { id: 'uncertainties', label: `Uncertainties (${research?.uncertaintyFlags?.length || 0})` },
                  { id: 'questions', label: `Questions (${research?.openQuestions?.length || 0})` },
                  { id: 'sources', label: `Sources (${research?.sources?.length || 0})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveEntityTab(tab.id as EntityTab)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    activeEntityTab === tab.id
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Quick Search Input */}
            <div className="relative w-full sm:w-60">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search research..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500/50"
              />
            </div>
          </div>

          {/* Section 1: Key Facts */}
          {(activeEntityTab === 'all' || activeEntityTab === 'facts') && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bookmark className="w-4 h-4 text-rose-400" />
                  <h3 className="text-sm font-semibold text-white">Key Facts</h3>
                  <span className="text-xs text-slate-400">({research?.facts?.length || 0})</span>
                </div>
              </div>

              <div className="space-y-3">
                {research?.facts
                  ?.filter((f) => matchesFilter(f.status, f.fact))
                  .map((fact) => (
                    <div
                      key={fact.id}
                      className="bg-slate-950 border border-slate-800/80 rounded-xl p-3.5 space-y-2.5 transition-all hover:border-slate-700"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-slate-200 leading-relaxed font-normal flex-1">
                          {fact.fact}
                        </p>

                        {/* Status Toggle Buttons */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            title="Mark as Verified / Supported"
                            onClick={() => updateItemStatus('facts', fact.id, 'verified')}
                            className={`px-2 py-1 text-[11px] rounded font-medium border flex items-center gap-1 cursor-pointer transition-colors ${
                              fact.status === 'verified'
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-emerald-400'
                            }`}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            Verified
                          </button>

                          <button
                            title="Needs Review"
                            onClick={() => updateItemStatus('facts', fact.id, 'needs_review')}
                            className={`px-2 py-1 text-[11px] rounded font-medium border flex items-center gap-1 cursor-pointer transition-colors ${
                              fact.status === 'needs_review'
                                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-indigo-400'
                            }`}
                          >
                            <Clock className="w-3 h-3" />
                            Needs Review
                          </button>

                          <button
                            title="Flag as Uncertain"
                            onClick={() => updateItemStatus('facts', fact.id, 'uncertain')}
                            className={`px-2 py-1 text-[11px] rounded font-medium border flex items-center gap-1 cursor-pointer transition-colors ${
                              fact.status === 'uncertain'
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-amber-400'
                            }`}
                          >
                            <HelpCircle className="w-3 h-3" />
                            Uncertain
                          </button>
                        </div>
                      </div>

                      {/* Source & Notes Footnote */}
                      {(fact.source || fact.notes) && (
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 pt-1 border-t border-slate-900">
                          {fact.source && (
                            <span className="flex items-center gap-1 text-slate-400">
                              <BookOpen className="w-3 h-3 text-slate-500" />
                              Source: <span className="text-slate-300">{fact.source}</span>
                            </span>
                          )}
                          {fact.notes && (
                            <span className="text-slate-400 italic">
                              Note: {fact.notes}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                {(!research?.facts || research.facts.length === 0) && (
                  <p className="text-xs text-slate-500 italic py-2">No factual records logged yet.</p>
                )}
              </div>
            </div>
          )}

          {/* Section 2: Numbers & Quantitative Metrics */}
          {(activeEntityTab === 'all' || activeEntityTab === 'numbers') && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Numbers & Quantitative Benchmarks</h3>
                <span className="text-xs text-slate-400">({research?.numbers?.length || 0})</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {research?.numbers
                  ?.filter((n) => matchesFilter(n.status, `${n.metric} ${n.value} ${n.context}`))
                  .map((num) => (
                    <div
                      key={num.id}
                      className="bg-slate-950 border border-slate-800/80 rounded-xl p-3.5 flex flex-col justify-between gap-2.5"
                    >
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                            {num.metric}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-[10px] rounded font-semibold border ${
                              num.status === 'verified'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : num.status === 'uncertain'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                            }`}
                          >
                            {num.status}
                          </span>
                        </div>
                        <div className="text-xl font-bold text-white tracking-tight">{num.value}</div>
                        <p className="text-xs text-slate-300">{num.context}</p>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-900">
                        <span className="text-[11px] text-slate-400 truncate max-w-[140px]">
                          {num.source || 'Domain benchmark'}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => updateItemStatus('numbers', num.id, 'verified')}
                            className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-900 cursor-pointer"
                            title="Verified"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => updateItemStatus('numbers', num.id, 'needs_review')}
                            className="p-1 rounded text-slate-400 hover:text-indigo-400 hover:bg-slate-900 cursor-pointer"
                            title="Needs Review"
                          >
                            <Clock className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => updateItemStatus('numbers', num.id, 'uncertain')}
                            className="p-1 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-900 cursor-pointer"
                            title="Uncertain"
                          >
                            <HelpCircle className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Section 3: Chronology & Key Dates */}
          {(activeEntityTab === 'all' || activeEntityTab === 'dates') && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-white">Chronology & Important Dates</h3>
                <span className="text-xs text-slate-400">({research?.dates?.length || 0})</span>
              </div>

              <div className="space-y-2.5">
                {research?.dates
                  ?.filter((d) => matchesFilter(d.status, `${d.date} ${d.event}`))
                  .map((d) => (
                    <div
                      key={d.id}
                      className="bg-slate-950 border border-slate-800/80 rounded-xl p-3.5 flex items-start justify-between gap-4"
                    >
                      <div className="flex items-start gap-3">
                        <span className="px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-300 font-mono text-xs font-semibold shrink-0">
                          {d.date}
                        </span>
                        <div>
                          <p className="text-xs text-slate-200 font-medium">{d.event}</p>
                          {d.source && (
                            <span className="text-[11px] text-slate-400 mt-1 block">Ref: {d.source}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => updateItemStatus('dates', d.id, 'verified')}
                          className={`p-1 rounded cursor-pointer ${
                            d.status === 'verified' ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 hover:text-emerald-400'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => updateItemStatus('dates', d.id, 'uncertain')}
                          className={`p-1 rounded cursor-pointer ${
                            d.status === 'uncertain' ? 'text-amber-400 bg-amber-500/10' : 'text-slate-400 hover:text-amber-400'
                          }`}
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Section 4: Key Figures & Names */}
          {(activeEntityTab === 'all' || activeEntityTab === 'names') && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-semibold text-white">Names & Key Domain Figures</h3>
                <span className="text-xs text-slate-400">({research?.names?.length || 0})</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {research?.names
                  ?.filter((n) => matchesFilter(n.status, `${n.name} ${n.role}`))
                  .map((n) => (
                    <div
                      key={n.id}
                      className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-sm font-medium text-white">{n.name}</div>
                        <div className="text-xs text-slate-400">{n.role}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateItemStatus('names', n.id, 'verified')}
                          className={`p-1 rounded cursor-pointer ${
                            n.status === 'verified' ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 hover:text-emerald-400'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => updateItemStatus('names', n.id, 'uncertain')}
                          className={`p-1 rounded cursor-pointer ${
                            n.status === 'uncertain' ? 'text-amber-400 bg-amber-500/10' : 'text-slate-400 hover:text-amber-400'
                          }`}
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Section 5: Claims & Speculative Hypotheses */}
          {(activeEntityTab === 'all' || activeEntityTab === 'claims') && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <FileQuestion className="w-4 h-4 text-rose-400" />
                <h3 className="text-sm font-semibold text-white">Claims (Factual vs. Speculative vs. Contested)</h3>
                <span className="text-xs text-slate-400">({research?.claims?.length || 0})</span>
              </div>

              <div className="space-y-3">
                {research?.claims
                  ?.filter((c) => matchesFilter(c.status, `${c.claim} ${c.claimType}`))
                  .map((claim) => (
                    <div
                      key={claim.id}
                      className="bg-slate-950 border border-slate-800/80 rounded-xl p-3.5 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 text-[10px] rounded font-semibold uppercase ${
                                claim.claimType === 'contested'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : claim.claimType === 'speculative'
                                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                  : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                              }`}
                            >
                              Type: {claim.claimType}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              Status: <span className="text-slate-300">{claim.status}</span>
                            </span>
                          </div>
                          <p className="text-xs text-slate-200 font-normal leading-relaxed">{claim.claim}</p>
                        </div>

                        {/* Status Toggle */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => updateItemStatus('claims', claim.id, 'verified')}
                            className="px-2 py-1 text-[11px] rounded bg-slate-900 hover:bg-emerald-950/40 text-slate-300 hover:text-emerald-300 border border-slate-800 cursor-pointer"
                          >
                            Mark Verified
                          </button>
                          <button
                            onClick={() => updateItemStatus('claims', claim.id, 'uncertain')}
                            className="px-2 py-1 text-[11px] rounded bg-slate-900 hover:bg-amber-950/40 text-slate-300 hover:text-amber-300 border border-slate-800 cursor-pointer"
                          >
                            Mark Uncertain
                          </button>
                        </div>
                      </div>

                      {claim.notes && (
                        <p className="text-[11px] text-slate-400 italic pt-1 border-t border-slate-900">
                          Evidence note: {claim.notes}
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Section 6: Uncertainty Flags & Nuances */}
          {(activeEntityTab === 'all' || activeEntityTab === 'uncertainties') && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-white">Uncertainty Flags & Conflicting Evidence</h3>
                <span className="text-xs text-slate-400">({research?.uncertaintyFlags?.length || 0})</span>
              </div>

              <div className="space-y-3">
                {research?.uncertaintyFlags?.map((u) => (
                  <div
                    key={u.id}
                    className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-3.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        {u.item}
                      </span>
                      <span className="px-2 py-0.5 text-[10px] rounded uppercase font-bold bg-amber-500/20 text-amber-300">
                        {u.level} Risk
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{u.reason}</p>
                  </div>
                ))}

                {(!research?.uncertaintyFlags || research.uncertaintyFlags.length === 0) && (
                  <p className="text-xs text-slate-500 italic">No critical uncertainties flagged.</p>
                )}
              </div>
            </div>
          )}

          {/* Section 7: Open Questions */}
          {(activeEntityTab === 'all' || activeEntityTab === 'questions') && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">Open Questions to Address in Script</h3>
                <span className="text-xs text-slate-400">({research?.openQuestions?.length || 0})</span>
              </div>

              <div className="space-y-2">
                {research?.openQuestions?.map((q) => (
                  <div
                    key={q.id}
                    className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-xs text-slate-200"
                  >
                    <span className="font-semibold text-indigo-300 mr-2">Q:</span>
                    {q.question}
                    {q.context && (
                      <span className="text-slate-400 block mt-1 text-[11px]">Context: {q.context}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right 1 Col: User Notes & Provider-Agnostic Source Editor */}
        <div className="space-y-6">
          {/* User Research Notes Editor */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-rose-400" />
                Creator Research Notes
              </h3>
              {saveSuccessNotice && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Saved!
                </span>
              )}
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Add your own notes, core angles, or editorial rules. The script generation engine will incorporate these notes verbatim.
            </p>

            <textarea
              id="user-research-notes-input"
              rows={6}
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              placeholder="e.g., Emphasize the economic breakthrough in scene 2. Do not state the 2028 timeline as guaranteed."
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500/50 resize-none font-sans"
            />

            {/* Provider-Agnostic User-Provided Sources */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <label className="text-xs font-semibold text-slate-200 block">
                User-Provided References & URLs
              </label>
              <p className="text-[11px] text-slate-400">
                Supply your primary documentation, papers, or citations to ground the generation:
              </p>
              <textarea
                id="user-provided-sources-input"
                rows={4}
                value={userProvidedSources}
                onChange={(e) => setUserProvidedSources(e.target.value)}
                placeholder="https://example.com/research-paper or citation text"
                className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500/50 resize-none font-mono"
              />
            </div>

            <button
              id="save-research-notes-btn"
              onClick={() => {
                if (!research) return;
                const updated: ResearchResult = {
                  ...research,
                  userNotes,
                  userProvidedSources,
                };
                saveResearchToServer(updated, true);
              }}
              disabled={isSaving}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              {isSaving ? 'Saving Notes...' : 'Save Research Notes'}
            </button>
          </div>

          {/* Hooks and Strategic Angles */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Algorithmic Hook Candidates
            </h4>
            <div className="space-y-2">
              {research?.hookSuggestions?.map((hook, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-slate-950 border border-slate-800/80 rounded-lg text-xs text-slate-300 leading-snug"
                >
                  &ldquo;{hook}&rdquo;
                </div>
              ))}
            </div>
          </div>

          {/* Primary Sources List */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-blue-400" />
              Documentary Sources
            </h4>
            <div className="space-y-2">
              {research?.sources?.map((s) => (
                <div
                  key={s.id}
                  className="p-2.5 bg-slate-950 border border-slate-800/80 rounded-lg text-xs space-y-1"
                >
                  <div className="font-medium text-slate-200">{s.title}</div>
                  <div className="text-[11px] text-slate-400 truncate">{s.citationOrUrl}</div>
                  <span className="inline-block px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    Reliability: {s.reliability}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
