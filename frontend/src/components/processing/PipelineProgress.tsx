import { CheckCircle2, Circle, Loader2, XCircle, FileText, Layers } from 'lucide-react';
import clsx from 'clsx';
import type { StepInfo } from '../../types/job';
import { STEP_LABELS } from '../../types/job';

interface PipelineProgressProps {
  steps: StepInfo[];
  progress: number;
  stepOutputs?: Record<string, any>;
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
  const completedCount = steps.filter((s) => s.status === 'completed').length;

  return (
    <div className="space-y-5">
      {/* Progress bar + label */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-200">Pipeline Progress</span>
          <span className="text-sm font-mono text-purple-400">{progress}%</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-gradient-to-r from-purple-600 to-purple-400 h-1.5 rounded-full transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-gray-500">
          {completedCount} of {steps.length} steps complete
        </p>
      </div>

      {/* Step list */}
      <div className="space-y-1">
        {steps.map((step, i) => {
          const isRunning = step.status === 'running';
          const isDone = step.status === 'completed';
          const isFailed = step.status === 'failed';
          const isPending = step.status === 'pending';

          return (
            <div
              key={step.name}
              className={clsx(
                'flex items-start gap-3 px-3 py-2.5 rounded-xl transition-all',
                isRunning  && 'bg-purple-500/8 border border-purple-500/25',
                isDone     && 'opacity-80',
                isFailed   && 'bg-red-500/8 border border-red-500/25',
                isPending  && 'opacity-35',
              )}
            >
              {/* Icon */}
              <div className="mt-0.5 shrink-0">
                {isDone   && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                {isRunning && <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />}
                {isFailed  && <XCircle className="w-4 h-4 text-red-500" />}
                {isPending && <Circle className="w-4 h-4 text-gray-700" />}
              </div>

              {/* Step content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={clsx(
                    'text-sm font-medium leading-snug',
                    isRunning  ? 'text-purple-200' : isDone ? 'text-gray-300' : isFailed ? 'text-red-300' : 'text-gray-600'
                  )}>
                    {STEP_LABELS[step.name] || step.name}
                  </p>
                  <span className="text-xs text-gray-700 font-mono shrink-0">{i + 1}/{steps.length}</span>
                </div>
                {step.message && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{step.message}</p>
                )}
                {isDone && stepOutputs[step.name] && (
                  <p className="text-xs mt-0.5">
                    <StepOutputSummary stepName={step.name} output={stepOutputs[step.name]} />
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
