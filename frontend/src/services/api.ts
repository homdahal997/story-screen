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
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = (data && (data.detail || data.message)) || `Request failed (${res.status})`;
    throw new Error(typeof message === 'string' ? message : 'Request failed');
  }
  return data as T;
}

// ---- Types ----
export interface User { id: string; name: string; email: string; created_at?: string }

export interface Character {
  id: string;
  name: string;
  role: string;
  detailed_visual_profile: string;
  image_url: string | null;
}

export interface SceneClip {
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'CANCELED';
  prediction_id: string;
  error: string | null;
  video_url: string | null;
}

export interface Scene {
  scene_number: number;
  heading: string;
  description: string;
  visual_prompt: string;
  camera_movement: string;
  dialogue: string;
  character_focus: string[];
  storyboard_url: string | null;
  clip: SceneClip | null;
}

export interface Project {
  id: string;
  title: string;
  prompt: string;
  orientation: 'vertical' | 'horizontal';
  art_style: string;
  scene_count: number;
  status: 'DRAFT' | 'SYNOPSIS' | 'SCRIPTED';
  synopsis: string;
  global_style: string;
  characters: Character[];
  scenes: Scene[];
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

// ---- Projects ----
export function listProjects() {
  return request<Project[]>('/projects');
}

export function getProject(id: string) {
  return request<Project>(`/projects/${id}`);
}

export function createProject(body: {
  title?: string; prompt: string; orientation: string; art_style: string; scene_count: number;
}) {
  return request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteProject(id: string) {
  return request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' });
}

// ---- Pipeline ----
export function generateSynopsis(id: string) {
  return request<Project>(`/projects/${id}/synopsis`, { method: 'POST' });
}

export function generateScript(id: string) {
  return request<Project>(`/projects/${id}/script`, { method: 'POST' });
}

export function generateCharacterImage(id: string, characterId: string) {
  return request<Project>(`/projects/${id}/characters/${characterId}/image`, { method: 'POST' });
}

export function generateStoryboard(id: string, sceneNumber: number) {
  return request<Project>(`/projects/${id}/scenes/${sceneNumber}/storyboard`, { method: 'POST' });
}

export function startSceneVideo(id: string, sceneNumber: number) {
  return request<{ scene_number: number; status: string; prediction_id: string }>(
    `/projects/${id}/scenes/${sceneNumber}/video`, { method: 'POST' });
}

export function pollSceneVideo(id: string, sceneNumber: number) {
  return request<{ scene_number: number; status: string; video_url?: string; error?: string }>(
    `/projects/${id}/scenes/${sceneNumber}/video`);
}

// ---- Featured ----
export function getFeatured() {
  return request<{ featured: FeaturedDrama[]; trending: FeaturedDrama[] }>('/featured');
}
