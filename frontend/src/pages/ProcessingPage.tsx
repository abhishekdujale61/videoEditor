import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { useJobPolling } from '../hooks/useJobPolling';
import PipelineProgress from '../components/processing/PipelineProgress';
import {
  AlertCircle, CheckCircle2, Clock, PauseCircle, Send, ChevronRight, FileText, Layers,
} from 'lucide-react';
import { pauseJob, submitInstructions } from '../api/videoApi';
import type { Job } from '../types/job';
import { STEP_LABELS } from '../types/job';

// How many seconds the pipeline waits before auto-continuing each review
const REVIEW_TIMEOUTS: Record<string, number> = {
  transcription: 45,
  ai_planning: 90,
};

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Transcription review panel ─────────────────────────────────────────────
function TranscriptionOutput({ output }: { output: any }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-green-400 font-semibold">{output.word_count?.toLocaleString()} words</span>
        <span className="text-gray-500">·</span>
        <span className="text-gray-300 capitalize">{output.language || 'unknown'}</span>
      </div>
      {output.excerpt && (
        <div className="bg-gray-800/60 rounded-lg px-3 py-2 text-xs text-gray-400 italic leading-relaxed border border-gray-700/50">
          "{output.excerpt}{output.excerpt.length >= 299 ? '…' : ''}"
        </div>
      )}
    </div>
  );
}

// ── AI Planning review panel ───────────────────────────────────────────────
function AiPlanningOutput({ output }: { output: any }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-purple-400 font-semibold">{output.shorts_count} shorts</span>
        <span className="text-gray-500">·</span>
        <span className="text-purple-400 font-semibold">{output.highlight_bites_count} highlight bites</span>
      </div>
      {output.video_summary && (
        <p className="text-xs text-gray-400 italic leading-relaxed">{output.video_summary}</p>
      )}
      {output.shorts?.length > 0 && (
        <div className="space-y-1.5">
          {output.shorts.map((s: any, i: number) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="text-purple-500 font-mono shrink-0 mt-0.5">{i + 1}.</span>
              <span className="text-gray-200 flex-1 leading-snug">{s.title}</span>
              <span className="text-gray-500 font-mono shrink-0">
                {formatTime(s.start)} → {formatTime(s.end)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Per-step review panel (shown when pipeline is awaiting_instructions) ───
function StepReviewPanel({
  job,
  countdown,
  onContinue,
  sending,
}: {
  job: Job;
  countdown: number;
  onContinue: (feedback: string) => void;
  sending: boolean;
}) {
  const [feedback, setFeedback] = useState('');
  const reviewStep = job.review_step;
  const output = reviewStep ? job.step_outputs?.[reviewStep] : null;

  if (!reviewStep) return null;

  const label = STEP_LABELS[reviewStep] || reviewStep;
  const nextStepHint =
    reviewStep === 'transcription'
      ? 'AI Content Planning'
      : reviewStep === 'ai_planning'
      ? 'Thumbnail Concept Design'
      : null;

  const renderOutput = () => {
    if (!output) return null;
    if (reviewStep === 'transcription') return <TranscriptionOutput output={output} />;
    if (reviewStep === 'ai_planning') return <AiPlanningOutput output={output} />;
    return null;
  };

  return (
    <div className="bg-gray-900 border border-purple-500/40 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
        <span className="font-semibold text-white">{label} — Review</span>
        <span className="ml-auto text-xs text-gray-500">
          {countdown > 0 ? (
            <span className="text-yellow-500/80">Auto-continuing in {countdown}s</span>
          ) : (
            <span className="text-gray-600">Auto-continued</span>
          )}
        </span>
      </div>

      {/* Step output */}
      {output && (
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/40">
          {renderOutput()}
        </div>
      )}

      {/* Feedback input */}
      {nextStepHint && (
        <div className="space-y-2">
          <label className="text-xs text-gray-400 font-medium">
            Feedback for {nextStepHint} <span className="text-gray-600">(optional)</span>
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={
              reviewStep === 'transcription'
                ? 'e.g. Focus on technical topics, ignore intro banter. Prioritize clips about deployment.'
                : 'e.g. Remove short #3, it overlaps with #1. Add a clip about the Q&A at the end.'
            }
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors resize-none"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => onContinue(feedback)}
          disabled={sending}
          className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {sending ? (
            <Clock className="w-4 h-4 animate-pulse" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          {sending ? 'Resuming…' : 'Approve & Continue'}
        </button>
        {feedback.trim() && (
          <span className="text-xs text-purple-400/70">Feedback will be used in {nextStepHint}</span>
        )}
      </div>
    </div>
  );
}

// ── Inline completed-step output (shown in progress list) ─────────────────
function CompletedStepDetail({ stepName, output }: { stepName: string; output: any }) {
  if (!output) return null;
  if (stepName === 'transcription') {
    return (
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        <FileText className="w-3 h-3" />
        {output.word_count?.toLocaleString()} words · {output.language}
      </div>
    );
  }
  if (stepName === 'ai_planning') {
    return (
      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
        <Layers className="w-3 h-3" />
        {output.shorts_count} shorts · {output.highlight_bites_count} bites planned
      </div>
    );
  }
  return null;
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function ProcessingPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { status, job, error, isAwaitingReview, isAwaitingInstructions, restartPolling } =
    useJobPolling(jobId ?? null);

  const [instructionText, setInstructionText] = useState('');
  const [sending, setSending] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Countdown for auto-continue
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<number | null>(null);

  // Start countdown when entering a step review
  useEffect(() => {
    if (isAwaitingInstructions && job?.review_step) {
      const timeout = REVIEW_TIMEOUTS[job.review_step] ?? 45;
      setCountdown(timeout);
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = window.setInterval(() => {
        setCountdown((prev) => Math.max(0, prev - 1));
      }, 1000);
    } else {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setCountdown(0);
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [isAwaitingInstructions, job?.review_step]);

  // Navigate away on review/complete/plan-edit/short-review
  useEffect(() => {
    if (isAwaitingReview && jobId) {
      navigate(`/review/${jobId}`, { replace: true });
    }
  }, [isAwaitingReview, jobId, navigate]);

  useEffect(() => {
    if (job?.status === 'awaiting_plan_edit' && jobId) {
      navigate(`/plan-edit/${jobId}`, { replace: true });
    }
  }, [job?.status, jobId, navigate]);

  useEffect(() => {
    if (job?.status === 'awaiting_short_review' && jobId) {
      navigate(`/short-review/${jobId}`, { replace: true });
    }
  }, [job?.status, jobId, navigate]);

  useEffect(() => {
    if (job?.status === 'completed') {
      navigate(`/results/${job.id}`, { replace: true });
    }
  }, [job, navigate]);

  // ── Step-review continue handler ──
  const handleStepContinue = async (feedback: string) => {
    if (!jobId) return;
    setSending(true);
    setActionError(null);
    try {
      await submitInstructions(jobId, feedback.trim());
      restartPolling();
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || err.message || 'Failed to continue');
    } finally {
      setSending(false);
    }
  };

  // ── Manual pause handler ──
  const handlePause = async () => {
    if (!jobId) return;
    setPausing(true);
    setActionError(null);
    try {
      await pauseJob(jobId);
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || err.message || 'Failed to pause');
    } finally {
      setPausing(false);
    }
  };

  // ── Manual instructions submit ──
  const handleSubmitInstructions = async () => {
    if (!jobId || !instructionText.trim()) return;
    setSending(true);
    setActionError(null);
    try {
      await submitInstructions(jobId, instructionText.trim());
      setInstructionText('');
      restartPolling();
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || err.message || 'Failed to submit instructions');
    } finally {
      setSending(false);
    }
  };

  if (!jobId) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center text-gray-400">
        No job ID provided.
      </div>
    );
  }

  // Whether pipeline is paused for a named step review (vs. a manual pause)
  const isStepReview = isAwaitingInstructions && !!job?.review_step;
  // Whether pipeline is paused for a manual instruction injection
  const isManualPause = isAwaitingInstructions && !job?.review_step;

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Processing Your Video</h1>
        <p className="text-gray-400">
          {isStepReview
            ? 'Review the step output below — approve to continue or add feedback.'
            : 'This may take a few minutes depending on video length.'}
        </p>
      </div>

      {/* Pipeline progress */}
      {status && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
          <PipelineProgress
            steps={status.steps}
            progress={status.progress}
            stepOutputs={job?.step_outputs ?? {}}
          />
        </div>
      )}

      {/* ── Step review panel (auto-pause after transcription / ai_planning) ── */}
      {isStepReview && job && (
        <StepReviewPanel
          job={job}
          countdown={countdown}
          onContinue={handleStepContinue}
          sending={sending}
        />
      )}

      {/* ── Manual pause awaiting instructions ── */}
      {isManualPause && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <PauseCircle className="w-5 h-5 text-blue-400" />
            <p className="font-medium text-blue-400">Pipeline Paused — Awaiting Instructions</p>
          </div>
          <p className="text-sm text-blue-300/80">
            Type your instructions below and click Resume. The pipeline will incorporate your
            guidance in the next AI steps.
          </p>
          <textarea
            value={instructionText}
            onChange={(e) => setInstructionText(e.target.value)}
            placeholder="e.g. Focus on the technical discussion, ignore the intro banter."
            rows={4}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
          />
          <button
            onClick={handleSubmitInstructions}
            disabled={sending || !instructionText.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Send className="w-4 h-4" />
            {sending ? 'Resuming…' : 'Resume Pipeline'}
          </button>
        </div>
      )}

      {/* ── Instruction injection while actively processing ── */}
      {status?.status === 'processing' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-gray-400">Producer Instructions</p>
          <p className="text-xs text-gray-500">
            Pause at the next checkpoint and inject custom context into the AI steps.
          </p>
          <textarea
            value={instructionText}
            onChange={(e) => setInstructionText(e.target.value)}
            placeholder="e.g. Prioritize clips about AI safety. Avoid clickbait titles."
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors resize-none"
          />
          <button
            onClick={handlePause}
            disabled={pausing}
            className="flex items-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            <PauseCircle className="w-4 h-4" />
            {pausing ? 'Requesting pause…' : 'Pause at Next Checkpoint'}
          </button>
        </div>
      )}

      {actionError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-400">
          {actionError}
        </div>
      )}

      {status?.status === 'awaiting_review' && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-start gap-3">
          <Clock className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-400">Review Required</p>
            <p className="text-sm text-yellow-400/80 mt-1">
              Redirecting you to select thumbnail concepts…
            </p>
          </div>
        </div>
      )}

      {error && status?.status === 'failed' && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-400">Processing Failed</p>
            <p className="text-sm text-red-400/80 mt-1">{error}</p>
          </div>
        </div>
      )}

      {!status && !error && (
        <div className="text-center text-gray-500 py-8 animate-pulse">
          Loading job status…
        </div>
      )}
    </div>
  );
}
