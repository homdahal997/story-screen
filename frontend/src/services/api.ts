import { getItem, setItem, removeItem } from '@/src/utils/storage';

const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;
const TOKEN_KEY = 'fs.token';

let authToken: string | null = null;

export async function loadToken(): Promise<string | null> {
  if (authToken) return authToken;
  authToken = await getItem(TOKEN_KEY);
  return authToken;
}

export async function setToken(token: string | null): Promise<void> {
  authToken = token;
  if (token) await setItem(TOKEN_KEY, token);
  else await removeItem(TOKEN_KEY);
}

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const text = await res.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Proxy/gateway returned HTML (e.g. a timeout page) instead of JSON.
      throw new Error(
        res.ok ? 'Unexpected server response. Please retry.' : `Server error (${res.status}). Please retry.`,
      );
    }
  }
  if (!res.ok) {
    const message = (data && (data.detail || data.message)) || `Request failed (${res.status})`;
    throw new Error(typeof message === 'string' ? message : 'Request failed');
  }
  return data as T;
}

// ---- Types ----
export interface User { id: string; name: string; email: string; created_at?: string }

export interface VoiceOption {
  voice_id: string;
  name: string;
  gender?: string | null;
  accent?: string | null;
  description?: string | null;
  category?: string | null;
}

export type RenderStatus = 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'CANCELED';

export interface ClipState {
  status: RenderStatus;
  error: string | null;
  video_url: string | null;
}

export interface EpisodeCharacter {
  id: string;
  name: string;
  detailed_visual_profile: string;
  image_url: string | null;
  voice: { voice_id: string; voice_name: string } | null;
}

export interface DialogueLine {
  line_id: string;
  character_id: string;
  text: string;
  order: number;
  audio_url: string | null;
  shot: ClipState | null;
}

export interface EpisodeScene {
  scene_number: number;
  character_focus: string[];
  visual_prompt: string;
  camera_movement: string;
  dialogue: string;
  dialogue_lines: DialogueLine[];
  duration_seconds: number;
  storyboard_url: string | null;
  master: ClipState | null;
  lines: DialogueLine[];
}

export interface PreviewShot {
  type: 'master' | 'dialogue';
  scene_number: number;
  line_id?: string;
  video_url: string;
}

export interface Episode {
  id: string;
  project_id: string;
  episode_number: number;
  status: 'DRAFT' | 'SYNOPSIS' | 'ASSETS' | 'MOTION' | 'VOICE' | 'READY';
  ready: boolean;
  orientation: 'vertical' | 'horizontal';
  synopsis: string;
  global_style: string;
  characters: EpisodeCharacter[];
  scenes: EpisodeScene[];
  preview: { shots: PreviewShot[]; total_seconds: number };
  series_title: string;
}

export interface EpisodeSummary {
  episode_number: number;
  status: 'NOT_STARTED' | 'DRAFT' | 'SYNOPSIS' | 'ASSETS' | 'MOTION' | 'VOICE' | 'READY';
  ready: boolean;
  locked: boolean;
  started: boolean;
}

export interface Series {
  id: string;
  title: string;
  prompt: string;
  orientation: 'vertical' | 'horizontal';
  art_style: string;
  total_episodes: number;
  episodes: EpisodeSummary[];
  ep1_ready: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface FeaturedDrama {
  id: string; title: string; genre: string; rating: number; episodes: number; poster: string;
}

// ---- Auth ----
export async function signup(name: string, email: string, password: string) {
  const data = await request<{ token: string; user: User }>('/auth/signup', {
    method: 'POST', body: JSON.stringify({ name, email, password }),
  });
  await setToken(data.token);
  return data.user;
}

export async function login(email: string, password: string) {
  const data = await request<{ token: string; user: User }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  await setToken(data.token);
  return data.user;
}

export async function me() {
  return request<User>('/auth/me');
}

export async function logout() {
  await setToken(null);
}

// ---- Series ----
export function listSeries() {
  return request<Series[]>('/projects');
}

export function getSeries(id: string) {
  return request<Series>(`/projects/${id}`);
}

export function createSeries(body: {
  title?: string; prompt: string; orientation: string; art_style: string; total_episodes: number;
}) {
  return request<Series>('/projects', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteSeries(id: string) {
  return request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' });
}

// ---- Episode ----
function epPath(projectId: string, n: number) {
  return `/projects/${projectId}/episodes/${n}`;
}

export function getEpisode(projectId: string, n: number) {
  return request<Episode>(epPath(projectId, n));
}

export function generateSynopsis(projectId: string, n: number) {
  return request<Episode>(`${epPath(projectId, n)}/synopsis`, { method: 'POST' });
}

export function generateScript(projectId: string, n: number) {
  return request<Episode>(`${epPath(projectId, n)}/script`, { method: 'POST' });
}

export function generateCharacterImage(projectId: string, n: number, characterId: string) {
  return request<Episode>(`${epPath(projectId, n)}/characters/${characterId}/image`, { method: 'POST' });
}

export function generateStoryboard(projectId: string, n: number, sceneNumber: number) {
  return request<Episode>(`${epPath(projectId, n)}/scenes/${sceneNumber}/storyboard`, { method: 'POST' });
}

export function startMotion(projectId: string, n: number, sceneNumber: number) {
  return request<{ scene_number: number; status: RenderStatus; prediction_id: string }>(
    `${epPath(projectId, n)}/scenes/${sceneNumber}/motion`, { method: 'POST' });
}

export function pollMotion(projectId: string, n: number, sceneNumber: number) {
  return request<{ scene_number: number; status: RenderStatus; video_url?: string; error?: string }>(
    `${epPath(projectId, n)}/scenes/${sceneNumber}/motion`);
}

// ---- Voices ----
export function listVoices() {
  return request<{ voices: VoiceOption[] }>('/voices');
}

export function autoAssignVoices(projectId: string, n: number) {
  return request<Episode>(`${epPath(projectId, n)}/voices/auto`, { method: 'POST' });
}

export function setVoice(projectId: string, n: number, characterId: string, voiceId: string, voiceName: string) {
  return request<Episode>(`${epPath(projectId, n)}/characters/${characterId}/voice`, {
    method: 'POST', body: JSON.stringify({ voice_id: voiceId, voice_name: voiceName }),
  });
}

// ---- Lip-sync dialogue shots ----
export function startShot(projectId: string, n: number, sceneNumber: number, lineId: string) {
  return request<{ scene_number: number; line_id: string; status: RenderStatus; prediction_id: string }>(
    `${epPath(projectId, n)}/scenes/${sceneNumber}/lines/${lineId}/shot`, { method: 'POST' });
}

export function pollShot(projectId: string, n: number, sceneNumber: number, lineId: string) {
  return request<{ scene_number: number; line_id: string; status: RenderStatus; video_url?: string; error?: string }>(
    `${epPath(projectId, n)}/scenes/${sceneNumber}/lines/${lineId}/shot`);
}

// ---- Featured ----
export function getFeatured() {
  return request<{ featured: FeaturedDrama[]; trending: FeaturedDrama[] }>('/featured');
}
