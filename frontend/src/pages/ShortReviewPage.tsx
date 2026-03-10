import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { useJobPolling } from '../hooks/useJobPolling';
import { regenerateShortImage, approveShort, getDownloadUrl } from '../api/videoApi';
import type { ThumbnailConcept, ShortReviewData } from '../types/job';
import { CheckCircle2, RefreshCw, Loader2, ImageIcon, Type, RotateCcw } from 'lucide-react';
import clsx from 'clsx';

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ConceptCard({
  concept, selected, onClick,
}: {
  concept: ThumbnailConcept; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left p-3.5 rounded-xl border transition-all space-y-1',
        selected
          ? 'border-purple-500/70 bg-purple-500/10 shadow-sm shadow-purple-900/20'
          : 'border-gray-800 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-900/60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-gray-200 leading-snug">{concept.title}</span>
        {selected && <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />}
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">{concept.description}</p>
    </button>
  );
}

export default function ShortReviewPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { job } = useJobPolling(jobId ?? null);

  const [review, setReview] = useState<ShortReviewData | null>(null);
  const [selectedConceptId, setSelectedConceptId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [overlayTitle, setOverlayTitle] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [localImagePath, setLocalImagePath] = useState<string | null>(null);
  const [localIteration, setLocalIteration] = useState(0);

  // Navigate when job transitions away
  useEffect(() => {
    if (!job) return;
    if (job.status === 'awaiting_plan_edit') navigate(`/plan-edit/${jobId}`, { replace: true });
    else if (job.status === 'completed') navigate(`/results/${jobId}`, { replace: true });
    else if (job.status === 'failed') navigate(`/processing/${jobId}`, { replace: true });
  }, [job?.status, jobId, navigate]);

  // Sync when short_index changes
  const lastShortIndex = useRef<number>(-1);
  useEffect(() => {
    if (!job?.short_review) return;
    const r = job.short_review;
    if (r.short_index !== lastShortIndex.current) {
      lastShortIndex.current = r.short_index;
      setReview(r);
      setSelectedConceptId(r.selected_concept_id);
      setPrompt(r.image_prompt);
      setOverlayTitle(r.title);
      setLocalImagePath(r.image_path);
      setLocalIteration(r.iteration);
      setActionError(null);
      setApproving(false);
    }
  }, [job?.short_review?.short_index]);

  // Sync iteration updates (after regenerate)
  useEffect(() => {
    if (!job?.short_review) return;
    const r = job.short_review;
    if (r.iteration > localIteration) {
      setLocalImagePath(r.image_path);
      setLocalIteration(r.iteration);
      setPrompt(r.image_prompt);
      setSelectedConceptId(r.selected_concept_id);
    }
  }, [job?.short_review?.iteration]);

  const handleRegenerate = async () => {
    if (!jobId || !prompt.trim()) return;
    setRegenerating(true);
    setActionError(null);
    try {
      const result = await regenerateShortImage(jobId, prompt.trim(), selectedConceptId);
      setLocalImagePath(result.image_path);
      setLocalIteration(result.iteration);
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || err.message || 'Image generation failed');
    } finally {
      setRegenerating(false);
    }
  };

  const handleApprove = async () => {
    if (!jobId || !review) return;
    setApproving(true);
    setActionError(null);
    try {
      await approveShort(jobId, overlayTitle.trim() || review.title, selectedConceptId, prompt.trim());
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || err.message || 'Failed to approve short');
      setApproving(false);
    }
  };

  if (!review) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 flex items-center justify-center gap-3 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading short review…</span>
      </div>
    );
  }

  const imageUrl = localImagePath ? getDownloadUrl(jobId!, localImagePath) : null;
  const isLast = review.short_index + 1 >= review.total_shorts;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">

      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full text-xs text-purple-400 font-medium">
          Short {review.short_index + 1} of {review.total_shorts}
        </div>
        {review.topic && (
          <p className="text-gray-300 font-semibold text-base leading-snug">{review.topic}</p>
        )}
        <p className="text-xs text-gray-600 font-mono">
          {formatTime(review.start_time)} → {formatTime(review.end_time)}
        </p>
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-1.5">
        {Array.from({ length: review.total_shorts }).map((_, i) => (
          <div
            key={i}
            className={clsx(
              'rounded-full transition-all duration-300',
              i < review.short_index  ? 'w-2 h-2 bg-green-500' :
              i === review.short_index ? 'w-4 h-2 bg-purple-500' :
              'w-2 h-2 bg-gray-800',
            )}
          />
        ))}
      </div>

      {/* Clip preview */}
      {review.clip_file && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Clip Preview</p>
          <video
            src={getDownloadUrl(jobId!, review.clip_file)}
            controls
            className="w-full rounded-xl border border-gray-800 bg-black shadow-sm"
            style={{ maxHeight: '280px' }}
          />
        </div>
      )}

      {/* Main content: concepts + image */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Left: concepts + title overlay */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Select Concept</p>
          {review.concepts.map((concept) => (
            <ConceptCard
              key={concept.id}
              concept={concept}
              selected={concept.id === selectedConceptId}
              onClick={() => {
                setSelectedConceptId(concept.id);
                setPrompt(concept.image_prompt);
                setOverlayTitle(concept.title);
              }}
            />
          ))}

          {/* Text overlay editor */}
          <div className="pt-1 space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
              <Type className="w-3 h-3" />
              Thumbnail Text
            </label>
            <input
              type="text"
              value={overlayTitle}
              onChange={(e) => setOverlayTitle(e.target.value)}
              placeholder="Title shown on the thumbnail…"
              className="w-full bg-gray-800/60 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
            />
            <p className="text-xs text-gray-600 leading-relaxed">
              This text will be composited onto the final thumbnail.
            </p>
          </div>
        </div>

        {/* Right: image preview + prompt */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Generated Image</p>
            {localIteration > 0 && (
              <span className="flex items-center gap-1 text-xs text-gray-600 font-mono">
                <RotateCcw className="w-3 h-3" />
                {localIteration} redo{localIteration !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Image area */}
          <div className="aspect-video bg-gray-900 rounded-xl overflow-hidden flex items-center justify-center border border-gray-800 shadow-sm">
            {regenerating ? (
              <div className="text-center text-gray-500 space-y-2">
                <Loader2 className="w-7 h-7 mx-auto animate-spin text-purple-500" />
                <p className="text-xs">Generating image…</p>
              </div>
            ) : imageUrl ? (
              <img
                src={`${imageUrl}?v=${localIteration}`}
                alt="Generated thumbnail background"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center text-gray-700 space-y-2">
                <ImageIcon className="w-8 h-8 mx-auto" />
                <p className="text-xs">No image yet</p>
              </div>
            )}
          </div>

          {/* Prompt editor */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Image Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Describe the background scene for DALL-E…"
              className="w-full bg-gray-800/60 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors resize-none"
            />
            <button
              onClick={handleRegenerate}
              disabled={regenerating || !prompt.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-200 text-sm font-medium rounded-xl border border-gray-700 transition-colors"
            >
              {regenerating
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              {regenerating ? 'Generating…' : 'Redo Image'}
            </button>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-400">
          {actionError}
        </div>
      )}

      {/* Approve */}
      <button
        onClick={handleApprove}
        disabled={approving || !selectedConceptId}
        className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors shadow-lg shadow-purple-900/30"
      >
        {approving
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <CheckCircle2 className="w-4 h-4" />}
        {approving
          ? 'Approving…'
          : isLast
          ? 'Approve & Finish'
          : `Approve & Next Short (${review.short_index + 2}/${review.total_shorts})`}
      </button>
    </div>
  );
}
