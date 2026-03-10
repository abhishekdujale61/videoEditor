import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getJob } from '../api/videoApi';
import { submitPlan } from '../api/videoApi';
import type { ShortPlanItem } from '../api/videoApi';
import { Plus, Trash2, ChevronRight, Loader2, Image } from 'lucide-react';

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

export default function PlanEditPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [shorts, setShorts] = useState<ShortPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    getJob(jobId).then((job) => {
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
    }).catch(() => {
      setError('Failed to load job');
      setLoading(false);
    });
  }, [jobId, navigate]);

  const update = (index: number, field: keyof ShortPlanItem, value: string | number) => {
    setShorts((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  const remove = (index: number) => {
    setShorts((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, index: i })));
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
      <div className="max-w-3xl mx-auto px-4 py-12 text-center text-gray-400 animate-pulse">
        Loading plan…
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Edit Shorts Plan</h1>
        <p className="text-gray-400">
          AI suggested {shorts.length} short{shorts.length !== 1 ? 's' : ''}. Edit titles, topics, and timestamps, then approve.
        </p>
      </div>

      <div className="space-y-3">
        {shorts.map((short, i) => (
          <div
            key={i}
            className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-purple-400">Short {i + 1}</span>
              <button
                onClick={() => remove(i)}
                className="text-gray-600 hover:text-red-400 transition-colors"
                title="Remove short"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Inline clip preview using HTML5 time fragments */}
            <video
              key={`${i}-${short.start_time}-${short.end_time}`}
              src={`/api/jobs/${jobId}/source#t=${short.start_time},${short.end_time}`}
              controls
              preload="metadata"
              className="w-full rounded-lg border border-gray-700 bg-gray-800"
              style={{ maxHeight: '160px' }}
            />

            <div className="grid grid-cols-1 gap-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Title</label>
                <input
                  type="text"
                  value={short.title}
                  onChange={(e) => update(i, 'title', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Topic</label>
                <input
                  type="text"
                  value={short.topic}
                  onChange={(e) => update(i, 'topic', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Start (m:ss)</label>
                  <input
                    type="text"
                    defaultValue={formatTime(short.start_time)}
                    onBlur={(e) => update(i, 'start_time', parseTime(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-purple-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">End (m:ss)</label>
                  <input
                    type="text"
                    defaultValue={formatTime(short.end_time)}
                    onBlur={(e) => update(i, 'end_time', parseTime(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-purple-500 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <Image className="w-3 h-3" />
                  Thumbnail Image Prompt
                </label>
                <textarea
                  value={short.image_prompt}
                  onChange={(e) => update(i, 'image_prompt', e.target.value)}
                  rows={2}
                  placeholder="Describe the thumbnail background for DALL-E (e.g. abstract glowing neural network, dark background, cinematic blue tones…)"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors resize-none"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addShort}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-dashed border-gray-700 hover:border-purple-500 text-gray-500 hover:text-purple-400 rounded-xl text-sm transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add Short
      </button>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting || shorts.length === 0}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
      >
        {submitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        {submitting ? 'Submitting…' : `Approve Plan — ${shorts.length} Short${shorts.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  );
}
