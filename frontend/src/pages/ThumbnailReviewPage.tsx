import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { useJobPolling } from '../hooks/useJobPolling';
import { redoThumbnail, approveThumbnail, getDownloadUrl } from '../api/videoApi';
import type { ThumbnailReviewData } from '../types/job';
import { CheckCircle2, RefreshCw, Loader2, ImageIcon, Type } from 'lucide-react';

export default function ThumbnailReviewPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { job } = useJobPolling(jobId ?? null);

  const [review, setReview] = useState<ThumbnailReviewData | null>(null);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [iteration, setIteration] = useState(0);
  const [redoing, setRedoing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Navigate when job transitions away from thumbnail review
  useEffect(() => {
    if (!job) return;
    if (job.status === 'awaiting_short_review') navigate(`/short-review/${jobId}`, { replace: true });
    else if (job.status === 'awaiting_thumbnail_review') return; // stay here
    else if (job.status === 'completed') navigate(`/results/${jobId}`, { replace: true });
    else if (job.status === 'failed') navigate(`/processing/${jobId}`, { replace: true });
    else if (job.status === 'processing') navigate(`/processing/${jobId}`, { replace: true });
  }, [job?.status, jobId, navigate]);

  // Track review index/type changes
  const lastKey = useRef('');
  useEffect(() => {
    if (!job?.thumbnail_review) return;
    const r = job.thumbnail_review;
    const key = `${r.review_type}-${r.short_index}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      setReview(r);
      setTitle(r.title);
      setSubtitle(r.subtitle);
      setIteration(r.iteration);
      setActionError(null);
      setApproving(false);
    }
  }, [job?.thumbnail_review?.review_type, job?.thumbnail_review?.short_index]);

  // Keep iteration in sync after redo
  useEffect(() => {
    if (!job?.thumbnail_review) return;
    if (job.thumbnail_review.iteration > iteration) {
      setIteration(job.thumbnail_review.iteration);
    }
  }, [job?.thumbnail_review?.iteration]);

  const handleRedo = async () => {
    if (!jobId || !title.trim()) return;
    setRedoing(true);
    setActionError(null);
    try {
      const result = await redoThumbnail(jobId, title.trim(), subtitle.trim());
      setIteration(result.iteration);
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || err.message || 'Redo failed');
    } finally {
      setRedoing(false);
    }
  };

  const handleApprove = async () => {
    if (!jobId) return;
    setApproving(true);
    setActionError(null);
    try {
      await approveThumbnail(jobId);
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || err.message || 'Approval failed');
      setApproving(false);
    }
  };

  if (!review) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 flex items-center justify-center gap-3 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading thumbnail review…</span>
      </div>
    );
  }

  const isShort = review.review_type === 'short';
  const imageUrl = review.thumbnail_file
    ? getDownloadUrl(jobId!, review.thumbnail_file)
    : null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">

      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full text-xs text-purple-400 font-medium">
          {isShort
            ? `Short ${review.short_index + 1} of ${review.total_shorts} — Thumbnail Review`
            : 'Main Episode Thumbnail Review'}
        </div>
        <p className="text-gray-400 text-sm">
          Review the composited thumbnail. Edit the text and redo as many times as you like.
        </p>
      </div>

      {/* Progress dots (shorts only) */}
      {isShort && review.total_shorts > 1 && (
        <div className="flex justify-center gap-1.5">
          {Array.from({ length: review.total_shorts }).map((_, i) => (
            <div
              key={i}
              className={[
                'rounded-full transition-all duration-300',
                i < review.short_index  ? 'w-2 h-2 bg-green-500' :
                i === review.short_index ? 'w-4 h-2 bg-purple-500' :
                'w-2 h-2 bg-gray-800',
              ].join(' ')}
            />
          ))}
        </div>
      )}

      {/* Thumbnail preview */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Composited Thumbnail
          </p>
          {iteration > 0 && (
            <span className="text-xs text-gray-600 font-mono">
              {iteration} redo{iteration !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="aspect-video bg-gray-900 rounded-xl overflow-hidden flex items-center justify-center border border-gray-800 shadow-sm">
          {redoing ? (
            <div className="text-center text-gray-500 space-y-2">
              <Loader2 className="w-7 h-7 mx-auto animate-spin text-purple-500" />
              <p className="text-xs">Recompositing…</p>
            </div>
          ) : imageUrl ? (
            <img
              src={`${imageUrl}&v=${iteration}`}
              alt="Composited thumbnail"
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="text-center text-gray-700 space-y-2">
              <ImageIcon className="w-8 h-8 mx-auto" />
              <p className="text-xs">No thumbnail yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Text editors */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <Type className="w-3 h-3" />
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Main title shown on the thumbnail…"
            className="w-full bg-gray-800/60 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Subtitle
          </label>
          <input
            type="text"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Subtitle / topic line…"
            className="w-full bg-gray-800/60 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
          />
        </div>

        <button
          onClick={handleRedo}
          disabled={redoing || !title.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-200 text-sm font-medium rounded-xl border border-gray-700 transition-colors"
        >
          {redoing
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <RefreshCw className="w-4 h-4" />}
          {redoing ? 'Recompositing…' : 'Redo Thumbnail'}
        </button>
      </div>

      {actionError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-400">
          {actionError}
        </div>
      )}

      {/* Approve */}
      <button
        onClick={handleApprove}
        disabled={approving}
        className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors shadow-lg shadow-purple-900/30"
      >
        {approving
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <CheckCircle2 className="w-4 h-4" />}
        {approving
          ? 'Approving…'
          : isShort
          ? review.short_index + 1 >= review.total_shorts
            ? 'Approve Thumbnail & Continue'
            : `Approve & Next Short (${review.short_index + 2}/${review.total_shorts})`
          : 'Approve Main Thumbnail & Finish'}
      </button>
    </div>
  );
}
