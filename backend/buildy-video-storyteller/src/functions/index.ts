import { superdevClient } from "@/lib/superdev/client";
import type { ElevenLabsVoice } from "@/lib/dramaStudio";

export type ReplicateLumaVideoOperation = "start" | "status" | "archive";
export type ReplicateLumaClipKind = "dialogue_closeup";
export type ReplicateLumaDialogueShotStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED" | "CANCELED";
export type ReplicateLumaDialogueShotRemoteStatus = "starting" | "processing" | "succeeded" | "failed" | "canceled";
export type ReplicateLumaDialogueShotSourceFrameType = "scene_storyboard" | "character_reference";

export interface ReplicateLumaDialogueShotClip {
  provider: string;
  prediction_id: string;
  scene_number: number;
  line_id: string;
  character_id: string;
  text: string;
  shot_role: "dialogue_closeup";
  source_frame_type: ReplicateLumaDialogueShotSourceFrameType;
  source_frame_url: string;
  prompt: string;
  duration_seconds: number;
  status: ReplicateLumaDialogueShotStatus;
  remote_status?: ReplicateLumaDialogueShotRemoteStatus;
  video_url?: string | null;
  content_type?: string | null;
  bytes?: number | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  error?: string | null;
}

export interface ReplicateLumaVideoRequest {
  operation: ReplicateLumaVideoOperation;
  project_id: string;
  scene_number: number;
  prediction_id?: string;
  source_storyboard_url?: string;
  prompt?: string;
  duration_seconds?: number;
  clip_kind?: ReplicateLumaClipKind;
  line_id?: string;
  character_id?: string;
  text?: string;
  dialogue?: string;
  source_frame_type?: ReplicateLumaDialogueShotSourceFrameType;
  source_frame_url?: string;
}

export interface ReplicateLumaDialogueCloseupStatusRequest {
  operation: "status";
  project_id: string;
  clip_kind: "dialogue_closeup";
  prediction_id: string;
}

export interface ReplicateLumaDialogueCloseupArchiveRequest {
  operation: "archive";
  project_id: string;
  clip_kind: "dialogue_closeup";
  prediction_id: string;
}

export type ReplicateLumaVideoRequestPayload =
  | ReplicateLumaVideoRequest
  | ReplicateLumaDialogueCloseupStatusRequest
  | ReplicateLumaDialogueCloseupArchiveRequest;

export interface ReplicateLumaVideoResponse {
  ok?: boolean;
  operation?: ReplicateLumaVideoOperation;
  clip_kind?: ReplicateLumaClipKind;
  prediction_id?: string;
  status?: string;
  remote_status?: string;
  ready_to_archive?: boolean;
  scene_number?: number;
  line_id?: string;
  character_id?: string;
  output_url?: string;
  file_url?: string;
  content_type?: string;
  bytes?: number;
  dialogue_shot_clip?: ReplicateLumaDialogueShotClip;
  error?: string;
  code?: string;
}

export const replicateLumaVideo = superdevClient.functions.replicateLumaVideo as unknown as (
  payload: ReplicateLumaVideoRequestPayload
) => Promise<ReplicateLumaVideoResponse>;

export type ElevenLabsVoiceOperation = "list_voices" | "synthesize_dialogue";

export interface ElevenLabsVoiceRequest {
  operation: ElevenLabsVoiceOperation;
  project_id?: string;
  scene_number?: number;
  character_id?: string;
  line_id?: string;
  voice_id?: string;
  voice_name?: string;
  dialogue?: string;
}

export interface ElevenLabsVoiceResponse {
  ok?: boolean;
  operation?: ElevenLabsVoiceOperation;
  voices?: ElevenLabsVoice[];
  scene_number?: number;
  line_id?: string;
  character_id?: string;
  voice_id?: string;
  voice_name?: string;
  audio_url?: string;
  content_type?: string;
  bytes?: number;
  text_length?: number;
  error?: string;
  code?: string;
}

export const elevenLabsVoice = superdevClient.functions.elevenlabsVoice as unknown as (
  payload: ElevenLabsVoiceRequest
) => Promise<ElevenLabsVoiceResponse>;

export type ElevenLabsSoundOperation = "generate_ambience";

export interface ElevenLabsSoundRequest {
  operation: ElevenLabsSoundOperation;
  project_id: string;
  scene_number: number;
  prompt: string;
  duration_seconds: number;
}

export interface ElevenLabsSoundResponse {
  ok?: boolean;
  operation?: ElevenLabsSoundOperation;
  scene_number?: number;
  prompt?: string;
  audio_url?: string;
  content_type?: string;
  duration_seconds?: number;
  bytes?: number;
  error?: string;
  code?: string;
}

export const elevenLabsSound = superdevClient.functions.elevenlabsSound as unknown as (
  payload: ElevenLabsSoundRequest
) => Promise<ElevenLabsSoundResponse>;

export type ReplicateLipsyncOperation = "start" | "status";
export type ReplicateLipsyncSourceClipKind = "dialogue_closeup";
export type ReplicateLipsyncStatus = "PROCESSING" | "READY" | "FAILED" | "CANCELED";

export interface ReplicateLipsyncStartRequest {
  operation: "start";
  project_id: string;
  scene_number: number;
  line_id: string;
  clip_prediction_id: string;
  character_id?: string;
  text?: string;
  dialogue?: string;
  source_video_url?: string;
  source_audio_url?: string;
  source_clip_kind?: ReplicateLipsyncSourceClipKind;
}

export interface ReplicateLipsyncStatusRequest {
  operation: "status";
  project_id: string;
  prediction_id: string;
}

export type ReplicateLipsyncRequest =
  | ReplicateLipsyncStartRequest
  | ReplicateLipsyncStatusRequest;

export interface ReplicateLipsyncStartResponse {
  ok?: boolean;
  operation?: "start";
  prediction_id?: string;
  status?: ReplicateLipsyncStatus;
  remote_status?: string;
  scene_number?: number;
  line_id?: string;
  character_id?: string;
  clip_prediction_id?: string;
  source_clip_kind?: ReplicateLipsyncSourceClipKind;
  source_clip_prediction_id?: string;
  error?: string;
  code?: string;
}

export interface ReplicateLipsyncStatusResponse {
  ok?: boolean;
  operation?: "status";
  prediction_id?: string;
  status?: ReplicateLipsyncStatus;
  remote_status?: string;
  file_url?: string;
  content_type?: string;
  bytes?: number;
  scene_number?: number;
  line_id?: string;
  character_id?: string;
  clip_prediction_id?: string;
  source_clip_kind?: ReplicateLipsyncSourceClipKind;
  source_clip_prediction_id?: string;
  error?: string;
  code?: string;
}

export type ReplicateLipsyncResponse =
  | ReplicateLipsyncStartResponse
  | ReplicateLipsyncStatusResponse;

export const replicateLipsync = superdevClient.functions.replicateLipsync as unknown as (
  payload: ReplicateLipsyncRequest
) => Promise<ReplicateLipsyncResponse>;

export type PixverseLipsyncOperation = "start" | "status";
export type PixverseLipsyncStatus = "PROCESSING" | "READY" | "FAILED" | "CANCELED";

export interface PixverseLipsyncStartRequest {
  operation: "start";
  project_id: string;
  scene_number: number;
  line_id: string;
  clip_prediction_id: string;
  character_id: string;
  text: string;
  source_video_url: string;
  source_audio_url: string;
}

export interface PixverseLipsyncStatusRequest {
  operation: "status";
  project_id: string;
  prediction_id: string;
}

export type PixverseLipsyncRequest =
  | PixverseLipsyncStartRequest
  | PixverseLipsyncStatusRequest;

export interface PixverseLipsyncStartResponse {
  ok?: boolean;
  operation?: "start";
  prediction_id?: string;
  status?: PixverseLipsyncStatus;
  remote_status?: string;
  scene_number?: number;
  line_id?: string;
  character_id?: string;
  clip_prediction_id?: string;
  source_clip_prediction_id?: string;
  error?: string;
  code?: string;
}

export interface PixverseLipsyncStatusResponse {
  ok?: boolean;
  operation?: "status";
  prediction_id?: string;
  status?: PixverseLipsyncStatus;
  remote_status?: string;
  file_url?: string;
  content_type?: string;
  bytes?: number;
  scene_number?: number;
  line_id?: string;
  character_id?: string;
  clip_prediction_id?: string;
  source_clip_prediction_id?: string;
  error?: string;
  code?: string;
}

export type PixverseLipsyncResponse =
  | PixverseLipsyncStartResponse
  | PixverseLipsyncStatusResponse;

export const pixverseLipsync = superdevClient.functions.pixverseLipsync as unknown as (
  payload: PixverseLipsyncRequest
) => Promise<PixverseLipsyncResponse>;
