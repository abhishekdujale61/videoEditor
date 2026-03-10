import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import DropZone from '../components/upload/DropZone';
import { listJobs, uploadVideoWithAssets, listAssets, uploadAsset, deleteAsset } from '../api/videoApi';
import type { Job } from '../types/job';
import type { AssetStatus } from '../api/videoApi';
import {
  Film, Clock, CheckCircle, AlertCircle, Loader2, UserCircle2, X, Video,
  Scissors, PackageOpen, CheckCircle2, Upload, Trash2, ChevronDown,
  Zap, Clapperboard,
} from 'lucide-react';
import clsx from 'clsx';

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
    completed:             { icon: CheckCircle,  color: 'text-green-400',  label: 'Completed' },
    processing:            { icon: Loader2,      color: 'text-purple-400', label: 'Processing' },
    awaiting_review:       { icon: Clock,        color: 'text-yellow-400', label: 'Awaiting Review' },
    awaiting_instructions: { icon: Clock,        color: 'text-blue-400',   label: 'Awaiting Input' },
    awaiting_plan_edit:    { icon: Clock,        color: 'text-orange-400', label: 'Plan Review' },
    awaiting_short_review: { icon: Clock,        color: 'text-pink-400',   label: 'Short Review' },
    queued:                { icon: Clock,        color: 'text-gray-500',   label: 'Queued' },
    failed:                { icon: AlertCircle,  color: 'text-red-400',    label: 'Failed' },
  };
  const { icon: Icon, color, label } = cfg[status] || cfg.queued;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium', color)}>
      <Icon className={clsx('w-3 h-3 shrink-0', status === 'processing' && 'animate-spin')} />
      {label}
    </span>
  );
}

function Collapsible({
  title, subtitle, icon: Icon, defaultOpen = false, children,
}: {
  title: string; subtitle?: string; icon: any; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-800/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5">
          <Icon className="w-4 h-4 text-purple-400 shrink-0" />
          <span className="text-sm font-semibold text-gray-200">{title}</span>
          {subtitle && <span className="text-xs text-gray-500 hidden sm:inline">{subtitle}</span>}
        </div>
        <ChevronDown className={clsx('w-4 h-4 text-gray-500 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && <div className="px-4 pb-4 pt-2 border-t border-gray-800/60 space-y-4">{children}</div>}
    </div>
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
    thumbnail: true, shorts: true, highlight: true, assembly: true,
  });
  const [assets, setAssets] = useState<Record<string, AssetStatus>>({});
  const [assetUploading, setAssetUploading] = useState<string | null>(null);

  const guestInputRef = useRef<HTMLInputElement>(null);
  const introInputRef = useRef<HTMLInputElement>(null);
  const outroInputRef = useRef<HTMLInputElement>(null);
  const assetInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const parseTime = (val: string): number | undefined => {
    if (!val.trim()) return undefined;
    const parts = val.split(':').map(Number);
    if (parts.some(isNaN)) return undefined;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  };

  useEffect(() => {
    listJobs().then(setRecentJobs).catch(() => {});
    listAssets().then(setAssets).catch(() => {});
  }, []);

  const handleAssetUpload = async (name: string, file: File) => {
    setAssetUploading(name);
    try {
      await uploadAsset(name, file);
      const updated = await listAssets();
      setAssets(updated);
    } catch (err: any) {
      setError(err?.response?.data?.detail || `Failed to upload ${name}`);
    } finally {
      setAssetUploading(null);
    }
  };

  const handleAssetDelete = async (name: string) => {
    try {
      await deleteAsset(name);
      setAssets((prev) => ({ ...prev, [name]: { ...prev[name], present: false } }));
    } catch { /* silent */ }
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    try {
      const response = await uploadVideoWithAssets(
        file, guestPhoto ?? undefined, setUploadProgress, guestName,
        introVideo ?? undefined, outroVideo ?? undefined,
        parseTime(trimStart), parseTime(trimEnd), features,
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

  const outputModeShorts = !features.assembly && !features.highlight;
  const outputModeFull = features.assembly && features.highlight;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">

      {/* Hero */}
      <div className="text-center space-y-3 pt-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full text-xs text-purple-400 font-medium">
          <Zap className="w-3 h-3" />
          AI-Powered Video Editor
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          Turn long videos into<br className="hidden sm:block" /> viral shorts
        </h1>
        <p className="text-gray-400 text-sm max-w-xl mx-auto leading-relaxed">
          Upload a podcast or interview. AI transcribes, plans the best clips, generates thumbnails,
          and you review each short before it's rendered.
        </p>
      </div>

      {/* Drop zone */}
      <DropZone onFileSelected={handleFile} uploading={uploading} uploadProgress={uploadProgress} />

      {/* Output Mode — prominent */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest px-0.5">Output Mode</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setFeatures({ thumbnail: true, shorts: true, highlight: false, assembly: false })}
            disabled={uploading}
            className={clsx(
              'relative px-4 py-4 rounded-xl text-left border transition-all duration-150 disabled:opacity-50',
              outputModeShorts
                ? 'bg-purple-600/15 border-purple-500/60 shadow-lg shadow-purple-900/20'
                : 'bg-gray-900/60 border-gray-800 hover:border-gray-700',
            )}
          >
            {outputModeShorts && (
              <span className="absolute top-2.5 right-3 text-purple-400">
                <CheckCircle2 className="w-4 h-4" />
              </span>
            )}
            <Clapperboard className={clsx('w-5 h-5 mb-2', outputModeShorts ? 'text-purple-400' : 'text-gray-500')} />
            <p className={clsx('text-sm font-semibold', outputModeShorts ? 'text-purple-200' : 'text-gray-300')}>
              Shorts Only
            </p>
            <p className="text-xs text-gray-500 mt-0.5 leading-snug">AI clips + thumbnails, no full assembly</p>
          </button>
          <button
            type="button"
            onClick={() => setFeatures({ thumbnail: true, shorts: true, highlight: true, assembly: true })}
            disabled={uploading}
            className={clsx(
              'relative px-4 py-4 rounded-xl text-left border transition-all duration-150 disabled:opacity-50',
              outputModeFull
                ? 'bg-purple-600/15 border-purple-500/60 shadow-lg shadow-purple-900/20'
                : 'bg-gray-900/60 border-gray-800 hover:border-gray-700',
            )}
          >
            {outputModeFull && (
              <span className="absolute top-2.5 right-3 text-purple-400">
                <CheckCircle2 className="w-4 h-4" />
              </span>
            )}
            <Film className={clsx('w-5 h-5 mb-2', outputModeFull ? 'text-purple-400' : 'text-gray-500')} />
            <p className={clsx('text-sm font-semibold', outputModeFull ? 'text-purple-200' : 'text-gray-300')}>
              Full Production
            </p>
            <p className="text-xs text-gray-500 mt-0.5 leading-snug">Shorts + highlight reel + assembled video</p>
          </button>
        </div>
        {/* Fine-grained toggles */}
        <details className="group">
          <summary className="text-xs text-gray-600 hover:text-gray-400 cursor-pointer list-none select-none transition-colors">
            Advanced toggles ▸
          </summary>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {(Object.keys(features) as Array<keyof typeof features>).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFeatures((prev) => ({ ...prev, [key]: !prev[key] }))}
                disabled={uploading}
                className={clsx(
                  'px-3 py-2 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50',
                  features[key]
                    ? 'bg-purple-600/20 border-purple-500/50 text-purple-300'
                    : 'bg-gray-800/60 border-gray-700 text-gray-500',
                )}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>
        </details>
      </div>

      {/* Collapsible settings */}
      <div className="space-y-2.5">

        {/* Episode Setup */}
        <Collapsible title="Episode Setup" subtitle="— guest name, photo, intro & outro" icon={UserCircle2}>
          <div className="space-y-4">
            {/* Guest name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400">Guest Name</label>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="e.g. Dr. Jane Smith"
                disabled={uploading}
                className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
              />
            </div>

            {/* Guest photo */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400">Guest Photo</label>
              {guestPhoto ? (
                <div className="flex items-center gap-3 px-3 py-2 bg-gray-800/40 border border-gray-700 rounded-lg">
                  <img src={URL.createObjectURL(guestPhoto)} alt="Guest"
                    className="w-9 h-9 rounded-full object-cover border border-gray-600" />
                  <span className="text-sm text-gray-300 flex-1 truncate">{guestPhoto.name}</span>
                  <button onClick={() => setGuestPhoto(null)} className="text-gray-500 hover:text-red-400 transition-colors p-1">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => guestInputRef.current?.click()}
                  className="text-sm text-purple-400 hover:text-purple-300 transition-colors">
                  + Add guest photo
                </button>
              )}
              <input ref={guestInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => e.target.files?.[0] && setGuestPhoto(e.target.files[0])} />
            </div>

            {/* Intro / Outro */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Intro Video', file: introVideo, setFile: setIntroVideo, ref: introInputRef },
                { label: 'Outro Video', file: outroVideo, setFile: setOutroVideo, ref: outroInputRef },
              ].map(({ label, file, setFile, ref }) => (
                <div key={label} className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-400">{label}</label>
                  {file ? (
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/40 border border-gray-700 rounded-lg">
                      <Video className="w-4 h-4 text-purple-400 shrink-0" />
                      <span className="text-xs text-gray-300 flex-1 truncate">{file.name}</span>
                      <button onClick={() => setFile(null)} className="text-gray-500 hover:text-red-400 p-0.5 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => ref.current?.click()}
                      className="text-sm text-purple-400 hover:text-purple-300 transition-colors">
                      + Add {label.toLowerCase()}
                    </button>
                  )}
                  <input ref={ref} type="file" accept="video/*" className="hidden"
                    onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
                </div>
              ))}
            </div>
          </div>
        </Collapsible>

        {/* Trim Video */}
        <Collapsible title="Trim Video" subtitle="— process only a segment" icon={Scissors}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400">Start Time</label>
              <input type="text" value={trimStart} onChange={(e) => setTrimStart(e.target.value)}
                placeholder="e.g. 1:00 or 60" disabled={uploading}
                className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400">End Time</label>
              <input type="text" value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)}
                placeholder="e.g. 5:00 or 300" disabled={uploading}
                className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50" />
            </div>
          </div>
          <p className="text-xs text-gray-600">Accepts m:ss (e.g. 1:30) or plain seconds (e.g. 90)</p>
        </Collapsible>

        {/* Default Studio Assets */}
        <Collapsible title="Studio Assets" subtitle="— default intro, outro, host photo, logo, background" icon={PackageOpen}>
          <div className="divide-y divide-gray-800/60">
            {([
              { name: 'intro',       label: 'Intro Video',        accept: 'video/*' },
              { name: 'outro',       label: 'Outro Video',        accept: 'video/*' },
              { name: 'host_photo',  label: 'Host Photo',         accept: 'image/*' },
              { name: 'logo',        label: 'Logo',               accept: 'image/*' },
              { name: 'bg_template', label: 'Background Template', accept: 'image/*' },
            ] as const).map(({ name, label, accept }) => {
              const status = assets[name];
              const busy = assetUploading === name;
              return (
                <div key={name} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {status?.present
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                      : <div className="w-3.5 h-3.5 rounded-full border border-gray-700 shrink-0" />}
                    <span className="text-sm text-gray-300">{label}</span>
                    {status?.present && (
                      <span className="text-xs text-gray-600 font-mono truncate hidden sm:block">{status.filename}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => assetInputRefs.current[name]?.click()}
                      disabled={busy}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-purple-400 hover:text-purple-300 disabled:opacity-50 transition-colors rounded"
                    >
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                      {status?.present ? 'Replace' : 'Upload'}
                    </button>
                    {status?.present && (
                      <button onClick={() => handleAssetDelete(name)}
                        className="p-1 text-gray-600 hover:text-red-400 transition-colors rounded">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                    <input
                      ref={(el) => { assetInputRefs.current[name] = el; }}
                      type="file" accept={accept} className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleAssetUpload(name, f);
                        e.target.value = '';
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Collapsible>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Recent Projects */}
      {recentJobs.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-widest">Recent Projects</h2>
            <span className="text-xs text-gray-600">{recentJobs.length} job{recentJobs.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {recentJobs.map((job) => (
              <button
                key={job.id}
                onClick={() => navigate(jobNavPath(job))}
                className="group bg-gray-900/60 border border-gray-800 hover:border-gray-700 rounded-xl p-3.5 text-left transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center shrink-0">
                    <Film className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate text-gray-200 group-hover:text-white transition-colors">
                      {job.filename}
                    </p>
                    <div className="mt-0.5">
                      <StatusBadge status={job.status} />
                    </div>
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
