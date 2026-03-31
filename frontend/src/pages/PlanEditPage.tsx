import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { getJob, submitPlan, getSourceUrl } from '../api/videoApi';
import type { ShortPlanItem } from '../api/videoApi';
import { Plus, Trash2, ChevronRight, Loader2, Sparkles, Clock } from 'lucide-react';

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseTime(str: string): number {
  const parts = str.split(':');
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  return parseFloat(str) || 0;
}

// Restricts video playback to the [startTime, endTime] window of the source video.
function ClipPreview({ jobId, startTime, endTime }: { jobId: string; startTime: number; endTime: number }) {
  const ref = useRef<HTMLVideoElement>(null);

  const enforce = () => {
    const v = ref.current;
    if (!v) return;
    if (v.currentTime < startTime) {
      v.currentTime = startTime;
    } else if (v.currentTime >= endTime) {
      v.pause();
      v.currentTime = startTime;
    }
  };

  return (
    <div className="relative bg-black rounded-xl overflow-hidden border border-gray-800">
      <video
        ref={ref}
        src={getSourceUrl(jobId!)}
        preload="none"
        controls
        onLoadedMetadata={() => { if (ref.current) ref.current.currentTime = startTime; }}
        onPlay={() => { if (ref.current && ref.current.currentTime < startTime) ref.current.currentTime = startTime; }}
        onTimeUpdate={enforce}
        onSeeked={enforce}
        className="w-full object-contain"
        style={{ maxHeight: '168px', display: 'block' }}
      />
      <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-white text-xs font-mono px-2 py-0.5 rounded-full pointer-events-none select-none">
        {formatTime(startTime)} – {formatTime(endTime)}
      </div>
    </div>
  );
}

export default function PlanEditPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [shorts, setShorts] = useState<ShortPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    getJob(jobId)
      .then((job) => {
        if (job.status !== 'awaiting_plan_edit') {
          navigate(`/processing/${jobId}`, { replace: true });
          return;
        }
        const items: ShortPlanItem[] = (job.awaiting_plan || []).map((s: any, i: number) => ({
          index: i,
          title: s.title || `Short ${i + 1}`,
          topic: s.topic || '',
          start_time: s.start_time ?? 0,
          end_time: s.end_time ?? 60,
          score: s.score ?? 0.7,
          image_prompt: s.image_prompt || '',
        }));
        setShorts(items);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load job');
        setLoading(false);
      });
  }, [jobId, navigate]);

  const update = (index: number, field: keyof ShortPlanItem, value: string | number) => {
    setShorts((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  const remove = (index: number) => {
    setShorts((prev) =>
      prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, index: i }))
    );
  };

  const addShort = () => {
    const last = shorts[shorts.length - 1];
    setShorts((prev) => [
      ...prev,
      {
        index: prev.length,
        title: `Short ${prev.length + 1}`,
        topic: '',
        start_time: last ? last.end_time : 0,
        end_time: last ? last.end_time + 60 : 60,
        score: 0.7,
        image_prompt: '',
      },
    ]);
  };

  const handleSubmit = async () => {
    if (!jobId || shorts.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitPlan(jobId, shorts);
      navigate(`/short-review/${jobId}`, { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Failed to submit plan');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 flex items-center justify-center gap-3 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading AI plan…</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      {/* Page header */}
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-white">Review AI Plan</h1>
        <p className="text-gray-400 text-sm leading-relaxed">
          AI suggested{' '}
          <span className="text-purple-400 font-semibold">{shorts.length} short{shorts.length !== 1 ? 's' : ''}</span>.
          Preview each clip, adjust titles and timestamps, then approve to begin per-short review.
        </p>
      </div>

      {/* Short cards */}
      <div className="space-y-4">
        {shorts.map((short, i) => {
          const dur = short.end_time - short.start_time;
          return (
            <div
              key={i}
              className="bg-gray-900/70 border border-gray-800 rounded-2xl overflow-hidden shadow-sm"
            >
              {/* Card header */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-900/50 border-b border-gray-800">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-purple-300 bg-purple-500/15 border border-purple-500/30 rounded-full">
                    {i + 1}
                  </span>
                  <span className="text-sm font-semibold text-gray-200 truncate">
                    {short.title || `Short ${i + 1}`}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 font-mono">
                    <Clock className="w-3 h-3" />
                    {formatTime(short.start_time)} – {formatTime(short.end_time)}
                    <span className="text-gray-600">· {dur.toFixed(0)}s</span>
                  </span>
                  <button
                    onClick={() => remove(i)}
                    className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Remove short"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Card body: clip preview + fields */}
              <div className="grid grid-cols-1 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-gray-800">
                {/* Video preview */}
                <div className="md:col-span-2 p-3">
                  <ClipPreview
                    key={`clip-${i}-${short.start_time.toFixed(1)}-${short.end_time.toFixed(1)}`}
                    jobId={jobId!}
                    startTime={short.start_time}
                    endTime={short.end_time}
                  />
                </div>

                {/* Edit fields */}
                <div className="md:col-span-3 p-4 space-y-3">
                  <div className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500">Title</label>
                      <input
                        type="text"
                        value={short.title}
                        onChange={(e) => update(i, 'title', e.target.value)}
                        className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500 transition-colors"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500">Topic</label>
                      <input
                        type="text"
                        value={short.topic}
                        onChange={(e) => update(i, 'topic', e.target.value)}
                        className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500 transition-colors"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-500">Start (m:ss)</label>
                        <input
                          type="text"
                          defaultValue={formatTime(short.start_time)}
                          onBlur={(e) => update(i, 'start_time', parseTime(e.target.value))}
                          className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-1.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-purple-500 transition-colors"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-500">End (m:ss)</label>
                        <input
                          type="text"
                          defaultValue={formatTime(short.end_time)}
                          onBlur={(e) => update(i, 'end_time', parseTime(e.target.value))}
                          className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-1.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-purple-500 transition-colors"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 text-purple-400" />
                        Thumbnail Image Prompt
                      </label>
                      <textarea
                        value={short.image_prompt}
                        onChange={(e) => update(i, 'image_prompt', e.target.value)}
                        rows={2}
                        placeholder="Describe the thumbnail background for DALL-E…"
                        className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors resize-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add short */}
      <button
        onClick={addShort}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-gray-700 hover:border-purple-500/60 text-gray-500 hover:text-purple-400 rounded-xl text-sm font-medium transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add Short
      </button>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Approve */}
      <button
        onClick={handleSubmit}
        disabled={submitting || shorts.length === 0}
        className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors shadow-lg shadow-purple-900/30"
      >
        {submitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        {submitting
          ? 'Starting review…'
          : `Approve Plan — ${shorts.length} Short${shorts.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  );
}
