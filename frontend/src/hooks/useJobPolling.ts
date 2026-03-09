import { useState, useEffect, useRef, useCallback } from 'react';
import { getJob } from '../api/videoApi';
import type { Job, JobStatusResponse } from '../types/job';

export function useJobPolling(jobId: string | null, intervalMs = 1500) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAwaitingReview, setIsAwaitingReview] = useState(false);
  const [isAwaitingInstructions, setIsAwaitingInstructions] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const j = await getJob(jobId);
        setJob(j);
        setError(null);

        setIsAwaitingReview(j.status === 'awaiting_review');
        setIsAwaitingInstructions(j.status === 'awaiting_instructions');

        // Stop polling only for terminal states — all other states keep polling
        if (j.status === 'completed' || j.status === 'failed') {
          stopPolling();
          if (j.status === 'failed' && j.error) setError(j.error);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch job status');
      }
    };

    poll();
    intervalRef.current = window.setInterval(poll, intervalMs);

    return stopPolling;
  }, [jobId, intervalMs, stopPolling]);

  // Force an immediate poll (e.g. after submitting instructions)
  const restartPolling = useCallback(() => {
    if (!jobId) return;
    getJob(jobId)
      .then((j) => {
        setJob(j);
        setIsAwaitingInstructions(j.status === 'awaiting_instructions');
        setIsAwaitingReview(j.status === 'awaiting_review');
        if (j.status === 'failed' && j.error) setError(j.error);
      })
      .catch(() => {});
  }, [jobId]);

  // Derive a lightweight status object for backward compat
  const status: JobStatusResponse | null = job
    ? { id: job.id, status: job.status, progress: job.progress, steps: job.steps, error: job.error }
    : null;

  return { status, job, error, isAwaitingReview, isAwaitingInstructions, restartPolling };
}
