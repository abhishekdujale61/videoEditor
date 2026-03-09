import { useState, useCallback } from 'react';
import { uploadVideo } from '../api/videoApi';

export function useFileUpload() {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (file: File): Promise<string | null> => {
    setUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      const response = await uploadVideo(file, setUploadProgress);
      return response.job_id;
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err.message || 'Upload failed';
      setError(msg);
      return null;
    } finally {
      setUploading(false);
    }
  }, []);

  return { upload, uploading, uploadProgress, error };
}
