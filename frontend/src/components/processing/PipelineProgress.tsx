import { CheckCircle, Circle, Loader2, XCircle, FileText, Layers } from 'lucide-react';
import clsx from 'clsx';
import type { StepInfo } from '../../types/job';
import { STEP_LABELS } from '../../types/job';

interface PipelineProgressProps {
  steps: StepInfo[];
  progress: number;
  stepOutputs?: Record<string, any>;
}

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed': return <CheckCircle className="w-5 h-5 text-green-500" />;
    case 'running':   return <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />;
    case 'failed':    return <XCircle className="w-5 h-5 text-red-500" />;
    default:          return <Circle className="w-5 h-5 text-gray-600" />;
  }
}

function StepOutputSummary({ stepName, output }: { stepName: string; output: any }) {
  if (!output) return null;
  if (stepName === 'transcription') {
    return (
      <span className="inline-flex items-center gap-1 text-gray-500">
        <FileText className="w-3 h-3" />
        {output.word_count?.toLocaleString?.()} words · {output.language}
      </span>
    );
  }
  if (stepName === 'ai_planning') {
    return (
      <span className="inline-flex items-center gap-1 text-gray-500">
        <Layers className="w-3 h-3" />
        {output.shorts_count} shorts · {output.highlight_bites_count} highlight bites
      </span>
    );
  }
  return null;
}

export default function PipelineProgress({ steps, progress, stepOutputs = {} }: PipelineProgressProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Processing Pipeline</h3>
        <span className="text-sm text-gray-400">{progress}%</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-1.5 mb-6">
        <div
          className="bg-purple-500 h-1.5 rounded-full transition-all duration-700"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div
            key={step.name}
            className={clsx(
              'flex items-start gap-3 px-3 py-2.5 rounded-lg transition-colors',
              step.status === 'running'   && 'bg-purple-500/10 border border-purple-500/30',
              step.status === 'completed' && 'bg-green-500/5',
              step.status === 'failed'    && 'bg-red-500/10 border border-red-500/30',
              step.status === 'pending'   && 'opacity-40',
            )}
          >
            <div className="flex items-center justify-center w-6 mt-0.5 shrink-0">
              <StepIcon status={step.status} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-snug">
                {STEP_LABELS[step.name] || step.name}
              </p>
              {step.message && (
                <p className="text-xs text-gray-400 mt-0.5 truncate">{step.message}</p>
              )}
              {step.status === 'completed' && stepOutputs[step.name] && (
                <p className="text-xs mt-0.5">
                  <StepOutputSummary stepName={step.name} output={stepOutputs[step.name]} />
                </p>
              )}
            </div>
            <span className="text-xs text-gray-600 shrink-0 mt-0.5">{i + 1}/{steps.length}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
