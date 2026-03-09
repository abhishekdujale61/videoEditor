import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getJob, getDownloadUrl } from '../api/videoApi';
import type { Job, ShortMeta } from '../types/job';
import VideoPlayer from '../components/results/VideoPlayer';
import ClipCard from '../components/results/ClipCard';
import DownloadAll from '../components/results/DownloadAll';
import { AlertCircle, Download, Image as ImageIcon, Star, Film } from 'lucide-react';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ShortCard({ short, jobId }: { short: ShortMeta; jobId: string }) {
  const [showVideo, setShowVideo] = useState(false);
  const clipUrl = short.clip_file ? getDownloadUrl(jobId, `short_${short.index}`) : null;
  const thumbUrl =
    short.thumbnail_files.length > 0
      ? getDownloadUrl(jobId, `short_${short.index}_thumbnail_0`)
      : null;
  const duration = short.end_time - short.start_time;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      {/* Thumbnail / player */}
      <div className="relative aspect-video bg-gray-800">
        {showVideo && clipUrl ? (
          <video src={clipUrl} controls autoPlay className="w-full h-full object-cover" />
        ) : (
          <>
            {thumbUrl ? (
              <img src={thumbUrl} alt={short.topic} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-600">
                <Film className="w-10 h-10" />
              </div>
            )}
            {clipUrl && (
              <button
                onClick={() => setShowVideo(true)}
                className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/50 transition-colors group"
              >
                <div className="w-12 h-12 rounded-full bg-white/20 group-hover:bg-white/30 flex items-center justify-center backdrop-blur-sm">
                  <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </button>
            )}
          </>
        )}
        {/* Score badge */}
        <div className="absolute top-2 right-2 bg-black/70 text-yellow-400 text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
          <Star className="w-3 h-3" />
          {Math.round(short.score * 100)}%
        </div>
      </div>

      <div className="p-4 space-y-2">
        <p className="text-sm font-medium text-white leading-snug">{short.topic || `Short ${short.index + 1}`}</p>
        <p className="text-xs text-gray-500">
          {formatDuration(short.start_time)} – {formatDuration(short.end_time)} &middot; {formatDuration(duration)}
        </p>
        {clipUrl && (
          <a
            href={clipUrl}
            download
            className="inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 no-underline"
          >
            <Download className="w-3 h-3" />
            Download clip
          </a>
        )}
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    getJob(jobId)
      .then(setJob)
      .catch((err) => setError(err.message || 'Failed to load results'));
  }, [jobId]);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center text-gray-500">
        <div className="animate-pulse">Loading results...</div>
      </div>
    );
  }

  const mainVideoUrl = job.main_video ? getDownloadUrl(job.id, 'main_video') : '';
  const mainThumbUrl = job.main_thumbnail ? getDownloadUrl(job.id, 'main_thumbnail') : undefined;
  const highlightUrl = job.highlight ? getDownloadUrl(job.id, 'highlight') : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 space-y-10">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Results</h1>
          <p className="text-gray-400 text-sm mt-1">{job.filename}</p>
        </div>
        <DownloadAll jobId={job.id} />
      </div>

      {/* Highlight reel at the top */}
      {highlightUrl && job.highlight && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-400" />
            <h2 className="text-xl font-semibold">Highlight Reel</h2>
            <span className="text-gray-500 text-sm">
              {formatDuration(job.highlight.duration)}
            </span>
          </div>
          <VideoPlayer src={highlightUrl} title="Highlight Reel" />
        </div>
      )}

      {mainVideoUrl && (
        <VideoPlayer src={mainVideoUrl} poster={mainThumbUrl} title="Main Video (with Intro/Outro)" />
      )}

      {mainThumbUrl && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-purple-400" />
              <h2 className="text-xl font-semibold">AI-Generated Thumbnail</h2>
            </div>
            <a
              href={mainThumbUrl}
              download
              className="inline-flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 no-underline"
            >
              <Download className="w-4 h-4" />
              Download Thumbnail
            </a>
          </div>
          <div className="rounded-xl overflow-hidden border border-gray-800 max-w-2xl">
            <img src={mainThumbUrl} alt="Video thumbnail" className="w-full" />
          </div>
        </div>
      )}

      {/* Shorts grid */}
      {job.shorts.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Shorts ({job.shorts.length})</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {job.shorts.map((short) => (
              <ShortCard key={short.index} short={short} jobId={job.id} />
            ))}
          </div>
        </div>
      )}

      {/* Legacy clips (backwards compat) */}
      {job.clips.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Best Moment Clips</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {job.clips.map((clip) => (
              <ClipCard key={clip.index} clip={clip} jobId={job.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
