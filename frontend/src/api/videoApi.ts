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

const CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB
const CHUNK_TIMEOUT_MS = 5 * 60 * 1000; // 5 min per chunk (covers slow connections)
const MAX_CHUNK_RETRIES = 3;

async function _uploadChunkWithRetry(
  job_id: string,
  index: number,
  totalChunks: number,
  blob: Blob,
  filename: string,
  onChunkProgress: (loaded: number, total: number) => void,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
    const form = new FormData();
    form.append('chunk_index', String(index));
    form.append('total_chunks', String(totalChunks));
    form.append('file', blob, filename);
    try {
      await client.post(`/api/upload/chunk/${job_id}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: CHUNK_TIMEOUT_MS,
        onUploadProgress: (e) => onChunkProgress(e.loaded, e.total ?? blob.size),
      });
      return; // success
    } catch (err) {
      lastError = err;
      // Brief back-off before retry (0 ms, 1 s, 2 s)
      if (attempt < MAX_CHUNK_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }
  throw lastError;
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
  shortsOrientation: 'landscape' | 'portrait' = 'landscape',
): Promise<UploadResponse> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  // Step 1 — init: validate extension + size on the server before any data moves
  const initForm = new FormData();
  initForm.append('filename', file.name);
  initForm.append('file_size', String(file.size));
  const { data: initData } = await client.post<{ job_id: string }>('/api/upload/init', initForm);
  const { job_id } = initData;

  // Step 2 — upload chunks sequentially with per-chunk retry
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const blob = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));

    await _uploadChunkWithRetry(
      job_id, i, totalChunks, blob, file.name,
      (loaded, total) => {
        if (onProgress) {
          const chunkDone = loaded / total;
          // Reserve last 5% for the finalize/assembly step
          const overall = ((i + chunkDone) / totalChunks) * 95;
          onProgress(Math.round(overall));
        }
      },
    );
  }

  // Step 3 — finalize: server assembles chunks, then starts the pipeline
  const finalForm = new FormData();
  finalForm.append('filename', file.name);
  finalForm.append('total_chunks', String(totalChunks));
  if (guestPhoto) finalForm.append('guest_photo', guestPhoto);
  if (guestName?.trim()) finalForm.append('guest_name', guestName.trim());
  if (introVideo) finalForm.append('intro_video', introVideo);
  if (outroVideo) finalForm.append('outro_video', outroVideo);
  if (trimStart !== undefined && trimStart > 0) finalForm.append('trim_start', String(trimStart));
  if (trimEnd !== undefined && trimEnd > 0) finalForm.append('trim_end', String(trimEnd));
  if (features) finalForm.append('features', JSON.stringify(features));
  finalForm.append('shorts_orientation', shortsOrientation);

  // Assembly can take a few seconds for very large files — use a generous timeout
  const { data } = await client.post<UploadResponse>(`/api/upload/finalize/${job_id}`, finalForm, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 10 * 60 * 1000, // 10 min for assembly of a large file
  });

  onProgress?.(100);
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

export async function redoThumbnail(
  jobId: string,
  title: string,
  subtitle: string,
): Promise<{ thumbnail_file: string; iteration: number }> {
  const { data } = await client.post(`/api/jobs/${jobId}/redo-thumbnail`, { title, subtitle });
  return data;
}

export async function approveThumbnail(jobId: string): Promise<void> {
  await client.post(`/api/jobs/${jobId}/approve-thumbnail`);
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
