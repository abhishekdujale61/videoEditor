import { useState } from 'react';
import { Play, Download, X } from 'lucide-react';
import type { ClipMeta } from '../../types/job';
import { getDownloadUrl } from '../../api/videoApi';

interface ClipCardProps {
  clip: ClipMeta;
  jobId: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ClipCard({ clip, jobId }: ClipCardProps) {
  const [playing, setPlaying] = useState(false);
  const clipUrl = getDownloadUrl(jobId, `clip_${clip.index}`);
  const thumbUrl = getDownloadUrl(jobId, `clip_${clip.index}_thumbnail`);

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 hover:border-gray-700 transition-colors">
      <div className="relative aspect-video bg-black">
        {playing ? (
          <>
            <video
              src={clipUrl}
              controls
              autoPlay
              className="w-full h-full object-contain"
            />
            <button
              onClick={() => setPlaying(false)}
              className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 rounded-full p-1 cursor-pointer"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </>
        ) : (
          <div className="group cursor-pointer w-full h-full" onClick={() => setPlaying(true)}>
            <img
              src={thumbUrl}
              alt={`Clip ${clip.index}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <div className="bg-purple-600/90 rounded-full p-3">
                <Play className="w-8 h-8 text-white" fill="white" />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold">Clip {clip.index}</h4>
          <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-1 rounded-full">
            Score: {(clip.score * 100).toFixed(0)}%
          </span>
        </div>
        <p className="text-sm text-gray-400">
          {formatTime(clip.start_time)} - {formatTime(clip.end_time)}
        </p>
        <p className="text-xs text-gray-500">{clip.reason}</p>
        <div className="flex items-center gap-3 pt-1">
          <a
            href={clipUrl}
            download
            className="inline-flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 no-underline"
          >
            <Download className="w-4 h-4" />
            Video
          </a>
          <a
            href={thumbUrl}
            download
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-300 no-underline"
          >
            <Download className="w-4 h-4" />
            Thumbnail
          </a>
        </div>
      </div>
    </div>
  );
}
