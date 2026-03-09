import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import DropZone from '../components/upload/DropZone';
import { listJobs, uploadVideoWithAssets } from '../api/videoApi';
import type { Job } from '../types/job';
import { Film, Clock, CheckCircle, AlertCircle, Loader2, UserCircle2, X, Video, Scissors, Sliders } from 'lucide-react';
import clsx from 'clsx';

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: typeof CheckCircle; color: string }> = {
    completed: { icon: CheckCircle, color: 'text-green-400' },
    processing: { icon: Loader2, color: 'text-purple-400' },
    awaiting_review: { icon: Clock, color: 'text-yellow-400' },
    awaiting_instructions: { icon: Clock, color: 'text-blue-400' },
    awaiting_plan_edit: { icon: Clock, color: 'text-orange-400' },
    awaiting_short_review: { icon: Clock, color: 'text-pink-400' },
    queued: { icon: Clock, color: 'text-yellow-400' },
    failed: { icon: AlertCircle, color: 'text-red-400' },
  };
  const { icon: Icon, color } = config[status] || config.queued;
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs', color)}>
      <Icon className={clsx('w-3.5 h-3.5', (status === 'processing') && 'animate-spin')} />
      {status.replace('_', ' ')}
    </span>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [guestPhoto, setGuestPhoto] = useState<File | null>(null);
  const [guestName, setGuestName] = useState('');
  const [introVideo, setIntroVideo] = useState<File | null>(null);
  const [outroVideo, setOutroVideo] = useState<File | null>(null);
  const [trimStart, setTrimStart] = useState('');
  const [trimEnd, setTrimEnd] = useState('');
  const [features, setFeatures] = useState({
    thumbnail: true,
    shorts: true,
    highlight: true,
    assembly: true,
  });
  const guestInputRef = useRef<HTMLInputElement>(null);
  const introInputRef = useRef<HTMLInputElement>(null);
  const outroInputRef = useRef<HTMLInputElement>(null);

  const parseTime = (val: string): number | undefined => {
    if (!val.trim()) return undefined;
    // Accept HH:MM:SS or plain seconds
    const parts = val.split(':').map(Number);
    if (parts.some(isNaN)) return undefined;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  };

  const toggleFeature = (key: keyof typeof features) => {
    setFeatures(prev => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    listJobs().then(setRecentJobs).catch(() => {});
  }, []);

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    try {
      const response = await uploadVideoWithAssets(
        file,
        guestPhoto ?? undefined,
        setUploadProgress,
        guestName,
        introVideo ?? undefined,
        outroVideo ?? undefined,
        parseTime(trimStart),
        parseTime(trimEnd),
        features,
      );
      navigate(`/processing/${response.job_id}`);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const jobNavPath = (job: Job) => {
    if (job.status === 'completed') return `/results/${job.id}`;
    if (job.status === 'awaiting_review') return `/review/${job.id}`;
    if (job.status === 'awaiting_plan_edit') return `/plan-edit/${job.id}`;
    if (job.status === 'awaiting_short_review') return `/short-review/${job.id}`;
    return `/processing/${job.id}`;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-12">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">AI Video Editor</h1>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
          Upload a video and let AI automatically transcribe, plan highlights, generate thumbnails,
          and extract the best shorts.
        </p>
      </div>

      <DropZone onFileSelected={handleFile} uploading={uploading} uploadProgress={uploadProgress} />

      {/* Guest info */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <UserCircle2 className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-gray-300">Guest Details</span>
          <span className="text-xs text-gray-500">— used in composited thumbnails</span>
        </div>

        {/* Guest name input */}
        <div className="space-y-1">
          <label className="text-xs text-gray-400 font-medium">Guest Name</label>
          <input
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="e.g. Dr. Vered Shwartz"
            disabled={uploading}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
          />
        </div>
        {/* Guest photo picker */}
        <div className="space-y-2">
          <label className="text-xs text-gray-400 font-medium">Guest Photo (optional)</label>
          {guestPhoto ? (
            <div className="flex items-center gap-3">
              <img
                src={URL.createObjectURL(guestPhoto)}
                alt="Guest"
                className="w-12 h-12 rounded-full object-cover border border-gray-700"
              />
              <span className="text-sm text-gray-300 flex-1 truncate">{guestPhoto.name}</span>
              <button
                onClick={() => setGuestPhoto(null)}
                className="text-gray-500 hover:text-red-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => guestInputRef.current?.click()}
              className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
            >
              + Add guest photo
            </button>
          )}
          <input
            ref={guestInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && setGuestPhoto(e.target.files[0])}
          />
        </div>
      </div>

      {/* Intro / Outro upload */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-gray-300">Intro &amp; Outro Videos</span>
          <span className="text-xs text-gray-500">— optional, overrides default assets</span>
        </div>

        {/* Intro */}
        <div className="space-y-1">
          <label className="text-xs text-gray-400 font-medium">Intro Video</label>
          {introVideo ? (
            <div className="flex items-center gap-3">
              <Film className="w-5 h-5 text-purple-400 shrink-0" />
              <span className="text-sm text-gray-300 flex-1 truncate">{introVideo.name}</span>
              <span className="text-xs text-gray-500">
                {(introVideo.size / 1024 / 1024).toFixed(1)} MB
              </span>
              <button
                onClick={() => setIntroVideo(null)}
                className="text-gray-500 hover:text-red-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => introInputRef.current?.click()}
              className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
            >
              + Add intro video
            </button>
          )}
          <input
            ref={introInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && setIntroVideo(e.target.files[0])}
          />
        </div>

        {/* Outro */}
        <div className="space-y-1">
          <label className="text-xs text-gray-400 font-medium">Outro Video</label>
          {outroVideo ? (
            <div className="flex items-center gap-3">
              <Film className="w-5 h-5 text-purple-400 shrink-0" />
              <span className="text-sm text-gray-300 flex-1 truncate">{outroVideo.name}</span>
              <span className="text-xs text-gray-500">
                {(outroVideo.size / 1024 / 1024).toFixed(1)} MB
              </span>
              <button
                onClick={() => setOutroVideo(null)}
                className="text-gray-500 hover:text-red-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => outroInputRef.current?.click()}
              className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
            >
              + Add outro video
            </button>
          )}
          <input
            ref={outroInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && setOutroVideo(e.target.files[0])}
          />
        </div>
      </div>

      {/* Trim timestamps */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Scissors className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-gray-300">Trim Video</span>
          <span className="text-xs text-gray-500">— optional, process only this segment</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-gray-400 font-medium">Start Time</label>
            <input
              type="text"
              value={trimStart}
              onChange={(e) => setTrimStart(e.target.value)}
              placeholder="e.g. 60 or 1:00"
              disabled={uploading}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-400 font-medium">End Time</label>
            <input
              type="text"
              value={trimEnd}
              onChange={(e) => setTrimEnd(e.target.value)}
              placeholder="e.g. 300 or 5:00"
              disabled={uploading}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
            />
          </div>
        </div>
        <p className="text-xs text-gray-600">Accepts seconds (e.g. 60) or HH:MM:SS format</p>
      </div>

      {/* Output mode — prominent toggle */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-gray-300">Output Mode</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setFeatures({ thumbnail: true, shorts: true, highlight: false, assembly: false })}
            disabled={uploading}
            className={clsx(
              'px-4 py-3 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-50 text-left space-y-1',
              !features.assembly && !features.highlight
                ? 'bg-purple-600/20 border-purple-500 text-purple-200'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600',
            )}
          >
            <div>Shorts Only</div>
            <div className="text-xs font-normal opacity-70">AI clips + thumbnails, no full video</div>
          </button>
          <button
            onClick={() => setFeatures({ thumbnail: true, shorts: true, highlight: true, assembly: true })}
            disabled={uploading}
            className={clsx(
              'px-4 py-3 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-50 text-left space-y-1',
              features.assembly && features.highlight
                ? 'bg-purple-600/20 border-purple-500 text-purple-200'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600',
            )}
          >
            <div>Full Production</div>
            <div className="text-xs font-normal opacity-70">Shorts + highlight reel + assembled video</div>
          </button>
        </div>
        {/* Fine-grained toggles */}
        <details className="group">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400 list-none select-none">
            Advanced feature toggles ▸
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(features) as Array<keyof typeof features>).map((key) => (
              <button
                key={key}
                onClick={() => toggleFeature(key)}
                disabled={uploading}
                className={clsx(
                  'px-3 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50',
                  features[key]
                    ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                    : 'bg-gray-800 border-gray-700 text-gray-500',
                )}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>
        </details>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {recentJobs.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Recent Projects</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentJobs.map((job) => (
              <button
                key={job.id}
                onClick={() => navigate(jobNavPath(job))}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-left hover:border-gray-700 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Film className="w-8 h-8 text-gray-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate text-white">{job.filename}</p>
                    <StatusBadge status={job.status} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
