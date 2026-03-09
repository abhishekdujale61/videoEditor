import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getConcepts, approveConcepts } from '../api/videoApi';
import type { ThumbnailConcept } from '../types/job';
import ConceptCard from '../components/review/ConceptCard';
import { CheckCircle, Loader2, AlertCircle, Layers } from 'lucide-react';

export default function ConceptReviewPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [concepts, setConcepts] = useState<ThumbnailConcept[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    getConcepts(jobId)
      .then((data) => {
        setConcepts(data);
        // Pre-select the first concept for each short
        const initial: Record<string, string> = {};
        const shorts = [...new Set(data.map((c) => c.short_index))];
        for (const idx of shorts) {
          const first = data.find((c) => c.short_index === idx);
          if (first) initial[String(idx)] = first.id;
        }
        setSelections(initial);
      })
      .catch((err) => setError(err.message || 'Failed to load concepts'))
      .finally(() => setLoading(false));
  }, [jobId]);

  const shortIndices = [...new Set(concepts.map((c) => c.short_index))].sort((a, b) => a - b);
  const allSelected = shortIndices.every((idx) => !!selections[String(idx)]);

  const handleApprove = async () => {
    if (!jobId || !allSelected) return;
    setSubmitting(true);
    setError(null);
    try {
      await approveConcepts(jobId, selections);
      navigate(`/processing/${jobId}`, { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Failed to approve concepts');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-purple-400" />
        Loading concepts...
      </div>
    );
  }

  if (error && concepts.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Layers className="w-6 h-6 text-purple-400" />
          <h1 className="text-2xl font-bold">Review Thumbnail Concepts</h1>
        </div>
        <p className="text-gray-400">
          Select one thumbnail concept for each short. AI will generate a DALL-E background image
          based on your selection.
        </p>
      </div>

      {shortIndices.map((shortIdx) => {
        const shortConcepts = concepts.filter((c) => c.short_index === shortIdx);
        const selectedId = selections[String(shortIdx)];

        return (
          <div key={shortIdx} className="space-y-3">
            <h2 className="text-lg font-semibold text-white">
              Short {shortIdx + 1}
              {shortConcepts[0] && (
                <span className="text-gray-500 font-normal text-sm ml-2">
                  — {shortConcepts[0].description.slice(0, 60)}...
                </span>
              )}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {shortConcepts.map((concept) => (
                <ConceptCard
                  key={concept.id}
                  concept={concept}
                  selected={selectedId === concept.id}
                  onSelect={(id) =>
                    setSelections((prev) => ({ ...prev, [String(shortIdx)]: id }))
                  }
                />
              ))}
            </div>
          </div>
        );
      })}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-gray-800">
        <p className="text-sm text-gray-500">
          {Object.keys(selections).length} / {shortIndices.length} shorts selected
        </p>
        <button
          onClick={handleApprove}
          disabled={!allSelected || submitting}
          className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle className="w-4 h-4" />
          )}
          Approve &amp; Generate Thumbnails
        </button>
      </div>
    </div>
  );
}
