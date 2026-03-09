import { Download } from 'lucide-react';
import { getDownloadAllUrl } from '../../api/videoApi';

interface DownloadAllProps {
  jobId: string;
}

export default function DownloadAll({ jobId }: DownloadAllProps) {
  return (
    <a
      href={getDownloadAllUrl(jobId)}
      download
      className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium transition-colors no-underline"
    >
      <Download className="w-5 h-5" />
      Download All Assets
    </a>
  );
}
