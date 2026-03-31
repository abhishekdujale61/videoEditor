import client from './client';
import type { Job, JobStatusResponse, ThumbnailConcept, UploadResponse } from '../types/job';

export interface ShortPlanItem {
  index: number;
  title: string;
  topic: string;
  start_time: number;
  end_time: number;
  score: number;
  image_prompt: string;
}

export async function uploadVideo(
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const { data } = await client.post<UploadResponse>('/api/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });
  return data;
}

export async function uploadVideoWithAssets(
  file: File,
  guestPhoto?: File,
  onProgress?: (percent: number) => void,
  guestName?: string,
  introVideo?: File,
  outroVideo?: File,
  trimStart?: number,
  trimEnd?: number,
  features?: Record<string, boolean>,
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (guestPhoto) {
    formData.append('guest_photo', guestPhoto);
  }
  if (guestName?.trim()) {
    formData.append('guest_name', guestName.trim());
  }
  if (introVideo) {
    formData.append('intro_video', introVideo);
  }
  if (outroVideo) {
    formData.append('outro_video', outroVideo);
  }
  if (trimStart !== undefined && trimStart > 0) {
    formData.append('trim_start', String(trimStart));
  }
  if (trimEnd !== undefined && trimEnd > 0) {
    formData.append('trim_end', String(trimEnd));
  }
  if (features) {
    formData.append('features', JSON.stringify(features));
  }

  const { data } = await client.post<UploadResponse>('/api/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });
  return data;
}

export async function pauseJob(jobId: string): Promise<void> {
  await client.post(`/api/jobs/${jobId}/pause`);
}

export async function submitInstructions(jobId: string, instructions: string): Promise<void> {
  await client.post(`/api/jobs/${jobId}/instructions`, { instructions, pause: false });
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  const { data } = await client.get<JobStatusResponse>(`/api/jobs/${jobId}/status`);
  return data;
}

export async function getJob(jobId: string): Promise<Job> {
  const { data } = await client.get<Job>(`/api/jobs/${jobId}`);
  return data;
}

export async function listJobs(): Promise<Job[]> {
  const { data } = await client.get<Job[]>('/api/jobs');
  return data;
}

export async function getConcepts(jobId: string): Promise<ThumbnailConcept[]> {
  const { data } = await client.get<ThumbnailConcept[]>(`/api/jobs/${jobId}/concepts`);
  return data;
}

export async function approveConcepts(
  jobId: string,
  selections: Record<string, string>
): Promise<void> {
  await client.post(`/api/jobs/${jobId}/approve-concepts`, { selections });
}

export async function submitPlan(jobId: string, shorts: ShortPlanItem[]): Promise<void> {
  await client.post(`/api/jobs/${jobId}/submit-plan`, { shorts });
}

export async function regenerateShortImage(
  jobId: string,
  prompt: string,
  conceptId?: string,
): Promise<{ image_path: string; iteration: number }> {
  const { data } = await client.post(`/api/jobs/${jobId}/regenerate-short-image`, {
    prompt,
    concept_id: conceptId ?? null,
  });
  return data;
}

export async function approveShort(
  jobId: string,
  title: string,
  conceptId: string,
  imagePrompt: string,
): Promise<void> {
  await client.post(`/api/jobs/${jobId}/approve-short`, {
    title,
    concept_id: conceptId,
    image_prompt: imagePrompt,
  });
}

export interface AssetStatus {
  present: boolean;
  filename: string;
}

export async function listAssets(): Promise<Record<string, AssetStatus>> {
  const { data } = await client.get('/api/assets');
  return data;
}

export async function uploadAsset(name: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  await client.post(`/api/assets/${name}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export async function deleteAsset(name: string): Promise<void> {
  await client.delete(`/api/assets/${name}`);
}

export function getSourceUrl(jobId: string): string {
  const token = localStorage.getItem('auth_token');
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `/api/jobs/${jobId}/source${query}`;
}

export function getDownloadUrl(jobId: string, asset: string): string {
  const token = localStorage.getItem('auth_token');
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `/api/download/${jobId}/${asset}${query}`;
}

export function getDownloadAllUrl(jobId: string): string {
  const token = localStorage.getItem('auth_token');
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `/api/download/${jobId}/all${query}`;
}
