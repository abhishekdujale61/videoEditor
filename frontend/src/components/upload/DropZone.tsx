import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileVideo } from 'lucide-react';
import clsx from 'clsx';

interface DropZoneProps {
  onFileSelected: (file: File) => void;
  uploading: boolean;
  uploadProgress: number;
}

const ACCEPTED = {
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
  'video/x-msvideo': ['.avi'],
  'video/x-matroska': ['.mkv'],
  'video/webm': ['.webm'],
  'video/m4v': ['.m4v']
};

export default function DropZone({ onFileSelected, uploading, uploadProgress }: DropZoneProps) {
  const onDrop = useCallback((accepted: File[]) => {
    if (accepted.length > 0) {
      onFileSelected(accepted[0]);
    }
  }, [onFileSelected]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxFiles: 1,
    disabled: uploading,
  });

  return (
    <div
      {...getRootProps()}
      className={clsx(
        'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all',
        isDragActive
          ? 'border-purple-500 bg-purple-500/10'
          : 'border-gray-700 hover:border-gray-500 bg-gray-900/50',
        uploading && 'pointer-events-none opacity-60'
      )}
    >
      <input {...getInputProps()} />
      {uploading ? (
        <div className="space-y-4">
          <FileVideo className="w-12 h-12 text-purple-500 mx-auto" />
          <p className="text-lg text-gray-300">Uploading...</p>
          <div className="w-full max-w-xs mx-auto bg-gray-800 rounded-full h-2">
            <div
              className="bg-purple-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-sm text-gray-500">{uploadProgress}%</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Upload className="w-12 h-12 text-gray-500 mx-auto" />
          <div>
            <p className="text-lg text-gray-300">
              {isDragActive ? 'Drop your video here' : 'Drag & drop a video file'}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              or click to browse — MP4, MOV, AVI, MKV, WebM (max 500MB)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
