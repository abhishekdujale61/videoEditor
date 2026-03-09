import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import type { ThumbnailConcept } from '../../types/job';

interface ConceptCardProps {
  concept: ThumbnailConcept;
  selected: boolean;
  onSelect: (id: string) => void;
}

export default function ConceptCard({ concept, selected, onSelect }: ConceptCardProps) {
  const [promptExpanded, setPromptExpanded] = useState(false);

  return (
    <div
      onClick={() => onSelect(concept.id)}
      className={clsx(
        'rounded-xl border-2 p-4 cursor-pointer transition-all space-y-3',
        selected
          ? 'border-purple-500 bg-purple-500/10'
          : 'border-gray-700 bg-gray-900 hover:border-gray-600'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Radio indicator */}
        <div
          className={clsx(
            'mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center',
            selected ? 'border-purple-400' : 'border-gray-600'
          )}
        >
          {selected && <div className="w-2 h-2 rounded-full bg-purple-400" />}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm">{concept.title}</p>
          <p className="text-gray-400 text-xs mt-1 leading-relaxed">{concept.description}</p>
        </div>
      </div>

      {/* Expandable prompt */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setPromptExpanded((v) => !v);
        }}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-400 transition-colors"
      >
        {promptExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {promptExpanded ? 'Hide' : 'Show'} image prompt
      </button>

      {promptExpanded && (
        <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-400 font-mono leading-relaxed">
          {concept.image_prompt}
        </div>
      )}
    </div>
  );
}
