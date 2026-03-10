import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { useJobPolling } from '../hooks/useJobPolling';
import { regenerateShortImage, approveShort, getDownloadUrl } from '../api/videoApi';
import type { ThumbnailConcept, ShortReviewData } from '../types/job';
import { CheckCircle2, RefreshCw, Loader2, Image, Type } from 'lucide-react';
import clsx from 'clsx';

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ConceptCard({
  concept,
  selected,
  onClick,
}: {
  concept: ThumbnailConcept;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left p-3 rounded-xl border transition-colors space-y-1',
        selected
          ? 'border-purple-500 bg-purple-500/10'
          : 'border-gray-700 bg-gray-800/50 hover:border-gray-600',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-gray-200 leading-snug">{concept.title}</span>
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

  // Track local image state separate from polling (avoids flicker)
  const [localImagePath, setLocalImagePath] = useState<string | null>(null);
  const [localIteration, setLocalIteration] = useState(0);

  // When job transitions away from short_review, navigate accordingly
  useEffect(() => {
    if (!job) return;
    if (job.status === 'awaiting_plan_edit') {
      navigate(`/plan-edit/${jobId}`, { replace: true });
    } else if (job.status === 'completed') {
      navigate(`/results/${jobId}`, { replace: true });
    } else if (job.status === 'failed') {
      navigate(`/processing/${jobId}`, { replace: true });
    }
  }, [job?.status, jobId, navigate]);

  // Sync review state from polled job data when short_review changes
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

  // Keep local image in sync when backend updates it (after regenerate)
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
      // polling will update the page with the next short
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || err.message || 'Failed to approve short');
      setApproving(false);
    }
  };

  if (!review) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center text-gray-400 animate-pulse">
        Loading short review…
      </div>
    );
  }

  const imageUrl = localImagePath ? getDownloadUrl(jobId!, localImagePath) : null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-6">
      {/* Header */}
      <div className="text-center space-y-1">
        <p className="text-xs text-purple-400 font-mono">
          Short {review.short_index + 1} of {review.total_shorts}
        </p>
        {review.topic && <p className="text-gray-400 text-sm">{review.topic}</p>}
        <p className="text-xs text-gray-600 font-mono">
          {formatTime(review.start_time)} → {formatTime(review.end_time)}
        </p>
      </div>

      {/* Clip preview */}
      {review.clip_file && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-400">Clip Preview</p>
          <video
            src={getDownloadUrl(jobId!, review.clip_file)}
            controls
            className="w-full rounded-xl border border-gray-700 bg-gray-800"
            style={{ maxHeight: '280px' }}
          />
        </div>
      )}

      {/* Progress dots */}
      <div className="flex justify-center gap-1.5">
        {Array.from({ length: review.total_shorts }).map((_, i) => (
          <div
            key={i}
            className={clsx(
              'w-2 h-2 rounded-full transition-colors',
              i < review.short_index
                ? 'bg-green-500'
                : i === review.short_index
                ? 'bg-purple-500'
                : 'bg-gray-700',
            )}
          />
        ))}
      </div>

      {/* Main layout: concepts left, image right */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Concept selection + title editor */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-gray-400">Select a Concept</p>
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

          {/* Editable title / text overlay */}
          <div className="pt-1 space-y-1">
            <label className="text-xs text-gray-500 flex items-center gap-1">
              <Type className="w-3 h-3" />
              Thumbnail Text Overlay
            </label>
            <input
              type="text"
              value={overlayTitle}
              onChange={(e) => setOverlayTitle(e.target.value)}
              placeholder="Title shown on the thumbnail…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
            />
            <p className="text-xs text-gray-600">This text will be composited onto the final thumbnail image.</p>
          </div>
        </div>

        {/* Image preview + prompt editor */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-400">Generated Image</p>
            {localIteration > 0 && (
              <span className="text-xs text-gray-600 font-mono">
                v{localIteration + 1} — {localIteration} redo{localIteration !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="aspect-video bg-gray-800 rounded-xl overflow-hidden flex items-center justify-center border border-gray-700">
            {regenerating ? (
              <div className="text-center text-gray-500 space-y-2">
                <Loader2 className="w-8 h-8 mx-auto animate-spin" />
                <p className="text-xs">Generating new image…</p>
              </div>
            ) : imageUrl ? (
              <img
                src={`${imageUrl}?v=${localIteration}`}
                alt="Generated thumbnail background"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center text-gray-600 space-y-1">
                <Image className="w-8 h-8 mx-auto" />
                <p className="text-xs">No image yet</p>
              </div>
            )}
          </div>

          {/* Prompt editor — edit and regenerate as many times as needed */}
          <div className="space-y-2">
            <label className="text-xs text-gray-500">
              Image Prompt — edit and regenerate until satisfied
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Describe the background scene for DALL-E…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors resize-none"
            />
            <button
              onClick={handleRegenerate}
              disabled={regenerating || !prompt.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {regenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
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

      {/* Approve button */}
      <button
        onClick={handleApprove}
        disabled={approving || !selectedConceptId}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
      >
        {approving ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <CheckCircle2 className="w-4 h-4" />
        )}
        {approving
          ? 'Approving…'
          : review.short_index + 1 < review.total_shorts
          ? `Approve & Next Short (${review.short_index + 2}/${review.total_shorts})`
          : 'Approve & Finish'}
      </button>
    </div>
  );
}
