import { colors, spacing } from '@/src/design-system/tokens';
import * as api from '@/src/services/api';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVideoPlayer, VideoView } from 'expo-video';

const STEPS = ['Synopsis', 'Script', 'Assets', 'Story', 'Motion', 'Voice', 'Lip-sync', 'Preview'];
const PURPLE = '#8B5CF6';
const GREEN = '#4ADE80';

interface Derived {
  hasSynopsis: boolean;
  hasScript: boolean;
  charsDone: boolean;
  boardsDone: boolean;
  motionDone: boolean;
  hasDialogue: boolean;
  dialogueCharIds: Set<string>;
  voicesDone: boolean;
  shotsDone: boolean;
}

function derive(ep: api.Episode): Derived {
  const hasSynopsis = !!ep.synopsis;
  const hasScript = ep.scenes.length > 0;
  const charsDone = hasScript && ep.characters.length > 0 && ep.characters.every((c) => !!c.image_url);
  const boardsDone = hasScript && ep.scenes.every((s) => !!s.storyboard_url);
  const motionDone = hasScript && ep.scenes.every((s) => s.master?.status === 'READY');
  const allLines = ep.scenes.flatMap((s) => s.lines);
  const hasDialogue = allLines.length > 0;
  const dialogueCharIds = new Set(allLines.map((l) => l.character_id));
  const voicesDone = !hasDialogue || ep.characters.filter((c) => dialogueCharIds.has(c.id)).every((c) => !!c.voice);
  const shotsDone = !hasDialogue || allLines.every((l) => l.shot?.status === 'READY');
  return { hasSynopsis, hasScript, charsDone, boardsDone, motionDone, hasDialogue, dialogueCharIds, voicesDone, shotsDone };
}

function computeStep(d: Derived): number {
  if (!d.hasSynopsis) return 1;
  if (!d.hasScript) return 2;
  if (!d.charsDone) return 3;
  if (!d.boardsDone) return 4;
  if (!d.motionDone) return 5;
  if (!d.voicesDone) return 6;
  if (!d.shotsDone) return 7;
  return 8;
}

function canAdvance(step: number, d: Derived): boolean {
  switch (step) {
    case 1: return d.hasSynopsis;
    case 2: return d.hasScript;
    case 3: return d.charsDone;
    case 4: return d.boardsDone;
    case 5: return d.motionDone;
    case 6: return d.voicesDone;
    case 7: return d.shotsDone;
    default: return true;
  }
}

export default function Pipeline() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ projectId: string; episode?: string }>();
  const projectId = params.projectId!;
  const n = Math.max(1, parseInt(params.episode || '1', 10) || 1);
  const qc = useQueryClient();

  const [currentStep, setCurrentStep] = useState(0);
  const [busy, setBusy] = useState(false); // full-screen (synopsis / script / voices)
  const [working, setWorking] = useState<string | null>(null); // per-item (image / storyboard / render)
  const [error, setError] = useState('');
  const [voicePicker, setVoicePicker] = useState<string | null>(null); // character id
  const [playing, setPlaying] = useState(false);

  const { data: ep, isLoading, isError, error: qErr } = useQuery({
    queryKey: ['episode', projectId, n],
    queryFn: () => api.getEpisode(projectId, n),
    enabled: !!projectId,
    retry: false,
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ['episode', projectId, n] });

  const d = ep ? derive(ep) : null;
  const ratio = ep?.orientation === 'horizontal' ? 16 / 9 : 9 / 16;

  // Initialise step from episode state (once).
  useEffect(() => {
    if (d && currentStep === 0) setCurrentStep(computeStep(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ep]);

  const runFull = async (fn: () => Promise<any>) => {
    setBusy(true); setError('');
    try { await fn(); await refetch(); }
    catch (e: any) { setError(e?.message || 'Something went wrong. Please retry.'); }
    finally { setBusy(false); }
  };

  const runItem = async (key: string, fn: () => Promise<any>) => {
    setWorking(key); setError('');
    try { await fn(); await refetch(); }
    catch (e: any) { setError(e?.message || 'Something went wrong. Please retry.'); }
    finally { setWorking(null); }
  };

  // Auto-generate for cheap text stages.
  const autoRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (!ep || !d || busy) return;
    if (currentStep === 1 && !d.hasSynopsis && !autoRef.current[`syn${n}`]) {
      autoRef.current[`syn${n}`] = true;
      runFull(() => api.generateSynopsis(projectId, n));
    }
    if (currentStep === 2 && d.hasSynopsis && !d.hasScript && !autoRef.current[`scr${n}`]) {
      autoRef.current[`scr${n}`] = true;
      runFull(() => api.generateScript(projectId, n));
    }
    if (currentStep === 6 && d.hasDialogue && !d.voicesDone && !autoRef.current[`voi${n}`]) {
      autoRef.current[`voi${n}`] = true;
      runFull(() => api.autoAssignVoices(projectId, n));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, ep]);

  // Poll pending master motion clips (step 5).
  const pendingMotion = ep ? ep.scenes.filter((s) => s.master && (s.master.status === 'QUEUED' || s.master.status === 'PROCESSING')) : [];
  const motionKey = pendingMotion.map((s) => s.scene_number).join(',');
  useEffect(() => {
    if (currentStep !== 5 || pendingMotion.length === 0) return;
    const t = setInterval(async () => {
      try { await Promise.all(pendingMotion.map((s) => api.pollMotion(projectId, n, s.scene_number))); } catch { /* transient */ }
      refetch();
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, motionKey, projectId, n]);

  // Poll pending lip-sync dialogue shots (step 7).
  const pendingShots = ep ? ep.scenes.flatMap((s) => s.lines
    .filter((l) => l.shot && (l.shot.status === 'QUEUED' || l.shot.status === 'PROCESSING'))
    .map((l) => ({ scene: s.scene_number, line: l.line_id }))) : [];
  const shotKey = pendingShots.map((p) => `${p.scene}:${p.line}`).join(',');
  useEffect(() => {
    if (currentStep !== 7 || pendingShots.length === 0) return;
    const t = setInterval(async () => {
      try { await Promise.all(pendingShots.map((p) => api.pollShot(projectId, n, p.scene, p.line))); } catch { /* transient */ }
      refetch();
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, shotKey, projectId, n]);

  const exit = () => router.replace({ pathname: '/project/[id]', params: { id: projectId } });

  if (isError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, justifyContent: 'center', alignItems: 'center', padding: spacing.xl }}>
        <Text style={{ color: colors.bone, fontSize: 16, textAlign: 'center' }}>
          {(qErr as any)?.message || 'This episode is locked or unavailable.'}
        </Text>
        <Pressable testID="pipeline-error-back" onPress={exit} style={{ marginTop: spacing.lg, backgroundColor: PURPLE, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 24 }}>
          <Text style={{ color: colors.bone, fontWeight: '700' }}>Back to Series</Text>
        </Pressable>
      </View>
    );
  }

  if (isLoading || !ep || !d || currentStep === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  const advance = canAdvance(currentStep, d);
  const goNext = () => {
    if (currentStep < 8) setCurrentStep(currentStep + 1);
    else exit();
  };
  const goBack = () => { if (currentStep > 1) setCurrentStep(currentStep - 1); else exit(); };

  const generatingHeadline =
    currentStep === 1 ? 'Creating story outline…' :
    currentStep === 2 ? 'Writing the screenplay…' :
    currentStep === 6 ? 'Casting character voices…' : 'Working…';

  const nextLabel = currentStep === 8 ? 'Finish' : `Next: ${STEPS[currentStep]}`;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, paddingTop: insets.top }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
        <Pressable testID="pipeline-back-button" onPress={goBack} hitSlop={12} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colors.bone, fontSize: 24 }}>‹</Text>
        </Pressable>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={{ color: colors.bone, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{ep.series_title || 'New Drama'}</Text>
          <Text style={{ color: colors.fog, fontSize: 11 }}>Episode {n}</Text>
        </View>
        <Pressable testID="pipeline-close-button" onPress={exit} hitSlop={12} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
          <Text style={{ color: colors.bone, fontSize: 20 }}>✕</Text>
        </Pressable>
      </View>

      {/* Segmented progress */}
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row' }}>
          {STEPS.map((_, i) => (
            <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < currentStep ? PURPLE : `${colors.fog}33`, marginHorizontal: 2 }} />
          ))}
        </View>
        <Text style={{ color: colors.fog, fontSize: 12, marginTop: spacing.sm }}>Step {currentStep} of 8 · <Text style={{ color: colors.bone, fontWeight: '600' }}>{STEPS[currentStep - 1]}</Text></Text>
      </View>

      {error ? (
        <View style={{ backgroundColor: `${colors.signal}22`, marginHorizontal: spacing.lg, padding: spacing.sm, borderRadius: 6 }}>
          <Text testID="pipeline-error" style={{ color: colors.signal, fontSize: 12 }}>{error}</Text>
        </View>
      ) : null}

      {/* Content */}
      {busy ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl }}>
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: PURPLE, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.lg }}>
            <ActivityIndicator color={colors.bone} size="large" />
          </View>
          <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '600' }}>{generatingHeadline}</Text>
          <Text style={{ color: colors.fog, fontSize: 13, marginTop: spacing.sm }}>This usually takes a few seconds</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}>
          {currentStep === 1 && (
            <View>
              <Text testID="synopsis-title" style={{ color: colors.bone, fontSize: 20, fontWeight: '700', marginBottom: spacing.md }}>{ep.series_title}</Text>
              <Text style={{ color: colors.fog, fontSize: 14, lineHeight: 22 }}>{ep.synopsis}</Text>
              <Pressable testID="regenerate-synopsis" disabled={busy} onPress={() => runFull(() => api.generateSynopsis(projectId, n))} style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }}>
                <Text style={{ color: PURPLE, fontSize: 14, fontWeight: '600' }}>↻ Regenerate synopsis</Text>
              </Pressable>
            </View>
          )}

          {currentStep === 2 && (
            <View>
              <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm }}>Characters</Text>
              {ep.characters.map((c) => (
                <View key={c.id} style={{ backgroundColor: colors.graphite, padding: spacing.md, borderRadius: 8, marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.bone, fontWeight: '700' }}>{c.name}</Text>
                  <Text style={{ color: colors.fog, fontSize: 12, marginTop: spacing.xs, lineHeight: 18 }}>{c.detailed_visual_profile}</Text>
                </View>
              ))}
              <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginVertical: spacing.md }}>Scene Breakdown</Text>
              {ep.scenes.map((s) => (
                <View key={s.scene_number} style={{ backgroundColor: colors.graphite, padding: spacing.md, borderRadius: 8, marginBottom: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: PURPLE, justifyContent: 'center', alignItems: 'center', marginRight: spacing.sm }}>
                      <Text style={{ color: colors.bone, fontSize: 11, fontWeight: '700' }}>{s.scene_number}</Text>
                    </View>
                    <Text style={{ color: colors.fog, fontSize: 11 }}>{s.duration_seconds}s · {s.camera_movement}</Text>
                  </View>
                  <Text style={{ color: colors.fog, fontSize: 13, lineHeight: 19 }}>{s.visual_prompt}</Text>
                  {!!s.dialogue && <Text style={{ color: colors.ochre, fontSize: 12, marginTop: spacing.xs, fontStyle: 'italic' }}>“{s.dialogue}”</Text>}
                </View>
              ))}
              <Pressable testID="regenerate-script" disabled={busy} onPress={() => runFull(() => api.generateScript(projectId, n))} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
                <Text style={{ color: PURPLE, fontSize: 14, fontWeight: '600' }}>↻ Regenerate script</Text>
              </Pressable>
            </View>
          )}

          {currentStep === 3 && (
            <View>
              <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.xs }}>Character Designs</Text>
              <Text style={{ color: colors.fog, fontSize: 12, marginBottom: spacing.md }}>Generate a reference image for each character. These lock their look across every scene.</Text>
              {ep.characters.map((c) => {
                const k = `char-${c.id}`;
                return (
                  <View key={c.id} style={{ backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, marginBottom: spacing.md, flexDirection: 'row' }}>
                    <View style={{ width: 72, height: 96, borderRadius: 8, overflow: 'hidden', backgroundColor: `${colors.fog}22`, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md }}>
                      {working === k ? <ActivityIndicator color={PURPLE} />
                        : c.image_url ? <Image source={{ uri: c.image_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                          : <Text style={{ color: colors.fog, fontSize: 22 }}>👤</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.bone, fontWeight: '700' }}>{c.name}</Text>
                      <Text style={{ color: colors.fog, fontSize: 11, marginTop: spacing.xs, lineHeight: 16 }} numberOfLines={4}>{c.detailed_visual_profile}</Text>
                      <Pressable
                        testID={`generate-character-${c.id}`}
                        disabled={!!working}
                        onPress={() => runItem(k, () => api.generateCharacterImage(projectId, n, c.id))}
                        style={{ marginTop: spacing.sm, alignSelf: 'flex-start', backgroundColor: working ? `${colors.fog}44` : PURPLE, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 14 }}
                      >
                        <Text style={{ color: colors.bone, fontSize: 12, fontWeight: '600' }}>{working === k ? '…' : c.image_url ? 'Regenerate' : 'Generate'}</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {currentStep === 4 && (
            <View>
              <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.xs }}>Storyboards</Text>
              <Text style={{ color: colors.fog, fontSize: 12, marginBottom: spacing.md }}>Compose each scene using the locked character references.</Text>
              {ep.scenes.map((s) => {
                const k = `board-${s.scene_number}`;
                return (
                  <View key={s.scene_number} style={{ marginBottom: spacing.lg }}>
                    <View style={{ aspectRatio: ratio, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.graphite, justifyContent: 'center', alignItems: 'center', maxHeight: 360, alignSelf: 'stretch' }}>
                      {working === k ? <ActivityIndicator color={PURPLE} />
                        : s.storyboard_url ? <Image source={{ uri: s.storyboard_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                          : <Text style={{ color: colors.fog }}>Scene {s.scene_number}</Text>}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
                      <Text style={{ color: colors.fog, fontSize: 12, flex: 1 }} numberOfLines={1}>Scene {s.scene_number}</Text>
                      <Pressable
                        testID={`generate-storyboard-${s.scene_number}`}
                        disabled={!!working}
                        onPress={() => runItem(k, () => api.generateStoryboard(projectId, n, s.scene_number))}
                        style={{ backgroundColor: working ? `${colors.fog}44` : PURPLE, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 14 }}
                      >
                        <Text style={{ color: colors.bone, fontSize: 12, fontWeight: '600' }}>{working === k ? '…' : s.storyboard_url ? 'Regenerate' : 'Generate'}</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {currentStep === 5 && (
            <View>
              <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.xs }}>Motion Clips</Text>
              <Text style={{ color: colors.fog, fontSize: 12, marginBottom: spacing.md }}>Each scene renders a ~5s silent motion clip. Rendering takes a couple of minutes per scene.</Text>
              {ep.scenes.map((s) => {
                const clip = s.master;
                const status = clip?.status;
                const rendering = status === 'QUEUED' || status === 'PROCESSING';
                const k = `motion-${s.scene_number}`;
                return (
                  <View key={s.scene_number} style={{ marginBottom: spacing.lg }}>
                    <View style={{ aspectRatio: ratio, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.graphite, justifyContent: 'center', alignItems: 'center', maxHeight: 360 }}>
                      {status === 'READY' && clip?.video_url ? <SceneClipPlayer uri={clip.video_url} muted />
                        : s.storyboard_url ? <Image source={{ uri: s.storyboard_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                          : <Text style={{ color: colors.fog }}>No storyboard</Text>}
                      {rendering && (
                        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' }}>
                          <ActivityIndicator color={colors.bone} />
                          <Text style={{ color: colors.bone, fontSize: 12, marginTop: spacing.sm }}>Rendering…</Text>
                        </View>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
                      <Text style={{ color: colors.fog, fontSize: 12, flex: 1 }} numberOfLines={1}>Scene {s.scene_number}</Text>
                      {!rendering && (
                        <Pressable
                          testID={`generate-motion-${s.scene_number}`}
                          disabled={!s.storyboard_url || working === k}
                          onPress={() => runItem(k, () => api.startMotion(projectId, n, s.scene_number))}
                          style={{ backgroundColor: s.storyboard_url ? PURPLE : `${colors.fog}44`, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 14 }}
                        >
                          <Text style={{ color: colors.bone, fontSize: 12, fontWeight: '600' }}>
                            {working === k ? '…' : status === 'READY' ? 'Re-render' : status === 'FAILED' ? 'Retry' : 'Generate clip'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                    {clip?.error ? <Text style={{ color: colors.signal, fontSize: 11, marginTop: spacing.xs }}>{clip.error}</Text> : null}
                  </View>
                );
              })}
            </View>
          )}

          {currentStep === 6 && (
            <View>
              <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.xs }}>Character Voices</Text>
              {!d.hasDialogue ? (
                <Text style={{ color: colors.fog, fontSize: 13 }}>This episode has no spoken dialogue — nothing to voice.</Text>
              ) : (
                <>
                  <Text style={{ color: colors.fog, fontSize: 12, marginBottom: spacing.md }}>Each speaking character is locked to a distinct voice. Tap Change to recast.</Text>
                  {ep.characters.map((c) => {
                    const speaks = d.dialogueCharIds.has(c.id);
                    return (
                      <View key={c.id} style={{ backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 44, height: 56, borderRadius: 6, overflow: 'hidden', backgroundColor: `${colors.fog}22`, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md }}>
                          {c.image_url ? <Image source={{ uri: c.image_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Text style={{ color: colors.fog }}>👤</Text>}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.bone, fontWeight: '700' }}>{c.name}</Text>
                          <Text style={{ color: speaks ? colors.ochre : colors.fog, fontSize: 12, marginTop: 2 }}>
                            {speaks ? (c.voice ? `🎙 ${c.voice.voice_name}` : 'Casting…') : 'No spoken lines'}
                          </Text>
                        </View>
                        {speaks && (
                          <Pressable testID={`change-voice-${c.id}`} onPress={() => setVoicePicker(c.id)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 14, backgroundColor: `${colors.fog}22` }}>
                            <Text style={{ color: colors.bone, fontSize: 12, fontWeight: '600' }}>Change</Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </>
              )}
            </View>
          )}

          {currentStep === 7 && (
            <View>
              <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.xs }}>Lip-sync Shots</Text>
              {!d.hasDialogue ? (
                <Text style={{ color: colors.fog, fontSize: 13 }}>No dialogue shots needed for this episode.</Text>
              ) : (
                <>
                  <Text style={{ color: colors.fog, fontSize: 12, marginBottom: spacing.md }}>Each spoken line renders a close-up of the speaking character in their locked voice, then lip-syncs it. This runs on demand.</Text>
                  {ep.scenes.map((s) => (
                    s.lines.length === 0 ? null : (
                      <View key={s.scene_number} style={{ marginBottom: spacing.lg }}>
                        <Text style={{ color: colors.fog, fontSize: 12, fontWeight: '700', marginBottom: spacing.sm }}>Scene {s.scene_number}</Text>
                        {s.lines.map((line) => {
                          const shot = line.shot;
                          const status = shot?.status;
                          const rendering = status === 'QUEUED' || status === 'PROCESSING';
                          const k = `shot-${s.scene_number}-${line.line_id}`;
                          const char = ep.characters.find((c) => c.id === line.character_id);
                          const charReady = !!char?.image_url;
                          return (
                            <View key={line.line_id} style={{ backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, marginBottom: spacing.sm }}>
                              <Text style={{ color: colors.bone, fontSize: 12, fontWeight: '600' }}>{char?.name || line.character_id}</Text>
                              <Text style={{ color: colors.fog, fontSize: 13, marginTop: 2, fontStyle: 'italic' }}>“{line.text}”</Text>
                              <View style={{ aspectRatio: ratio, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.ink, justifyContent: 'center', alignItems: 'center', maxHeight: 300, marginTop: spacing.sm }}>
                                {status === 'READY' && shot?.video_url ? <SceneClipPlayer uri={shot.video_url} />
                                  : char?.image_url ? <Image source={{ uri: char.image_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                                    : <Text style={{ color: colors.fog }}>Shot</Text>}
                                {rendering && (
                                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' }}>
                                    <ActivityIndicator color={colors.bone} />
                                    <Text style={{ color: colors.bone, fontSize: 12, marginTop: spacing.sm }}>Rendering shot…</Text>
                                  </View>
                                )}
                              </View>
                              {!rendering && (
                                <Pressable
                                  testID={`generate-shot-${s.scene_number}-${line.line_id}`}
                                  disabled={!charReady || working === k}
                                  onPress={() => runItem(k, () => api.startShot(projectId, n, s.scene_number, line.line_id))}
                                  style={{ marginTop: spacing.sm, alignSelf: 'flex-start', backgroundColor: charReady ? PURPLE : `${colors.fog}44`, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 14 }}
                                >
                                  <Text style={{ color: colors.bone, fontSize: 12, fontWeight: '600' }}>
                                    {working === k ? '…' : status === 'READY' ? 'Re-render' : status === 'FAILED' ? 'Retry' : 'Generate shot'}
                                  </Text>
                                </Pressable>
                              )}
                              {!charReady && <Text style={{ color: colors.fog, fontSize: 11, marginTop: spacing.xs }}>Generate this character&apos;s image first.</Text>}
                              {shot?.error ? <Text style={{ color: colors.signal, fontSize: 11, marginTop: spacing.xs }}>{shot.error}</Text> : null}
                            </View>
                          );
                        })}
                      </View>
                    )
                  ))}
                </>
              )}
            </View>
          )}

          {currentStep === 8 && (
            <PreviewStep ep={ep} ratio={ratio} onPlay={() => setPlaying(true)} />
          )}
        </ScrollView>
      )}

      {/* Bottom button */}
      <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md }}>
        <Pressable
          testID="pipeline-next-button"
          onPress={goNext}
          disabled={busy || !advance}
          style={{ backgroundColor: busy || !advance ? `${colors.fog}44` : PURPLE, paddingVertical: spacing.md, borderRadius: 24, alignItems: 'center' }}
        >
          <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>{busy ? 'Working…' : nextLabel}</Text>
        </Pressable>
        {!advance && !busy && currentStep < 8 && (
          <Text style={{ color: colors.fog, fontSize: 11, textAlign: 'center', marginTop: spacing.sm }}>Finish this step to continue.</Text>
        )}
      </View>

      {voicePicker && (
        <VoicePickerModal
          onClose={() => setVoicePicker(null)}
          onSelect={async (v) => {
            const cid = voicePicker;
            setVoicePicker(null);
            await runFull(() => api.setVoice(projectId, n, cid, v.voice_id, v.name));
          }}
        />
      )}

      {playing && <SequentialPreview urls={buildPlaylist(ep)} onClose={() => setPlaying(false)} ratio={ratio} />}
    </View>
  );
}

function buildPlaylist(ep: api.Episode): string[] {
  const urls: string[] = [];
  for (const s of ep.scenes) {
    const shots = s.lines.filter((l) => l.shot?.status === 'READY' && l.shot.video_url).map((l) => l.shot!.video_url!);
    if (shots.length) urls.push(...shots);
    else if (s.master?.status === 'READY' && s.master.video_url) urls.push(s.master.video_url);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Preview step
// ---------------------------------------------------------------------------
function PreviewStep({ ep, ratio, onPlay }: { ep: api.Episode; ratio: number; onPlay: () => void }) {
  const playlist = buildPlaylist(ep);
  return (
    <View>
      <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.xs }}>Episode Preview</Text>
      <Text style={{ color: colors.fog, fontSize: 12, marginBottom: spacing.md }}>
        Plays your generated shots back-to-back. Lip-synced dialogue includes voice audio.
      </Text>

      {playlist.length > 0 ? (
        <Pressable
          testID="play-preview-button"
          onPress={onPlay}
          style={{ backgroundColor: colors.signal, paddingVertical: spacing.md, borderRadius: 10, alignItems: 'center', marginBottom: spacing.lg }}
        >
          <Text style={{ color: colors.bone, fontWeight: '700' }}>▶ Play preview ({playlist.length} shot{playlist.length > 1 ? 's' : ''})</Text>
        </Pressable>
      ) : (
        <Text style={{ color: colors.fog, fontSize: 13, marginBottom: spacing.lg }}>Generate motion clips and lip-sync shots to build the preview.</Text>
      )}

      {ep.scenes.map((s) => {
        const dialogueReady = s.lines.filter((l) => l.shot?.status === 'READY').length;
        const masterReady = s.master?.status === 'READY';
        return (
          <View key={s.scene_number} style={{ backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: masterReady ? GREEN : `${colors.fog}22`, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md }}>
              <Text style={{ color: colors.bone, fontSize: 13, fontWeight: '700' }}>{s.scene_number}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.bone, fontSize: 13, fontWeight: '600' }}>Scene {s.scene_number}</Text>
              <Text style={{ color: colors.fog, fontSize: 11, marginTop: 2 }}>
                {masterReady ? 'Motion ready' : 'Motion pending'}{s.lines.length ? ` · ${dialogueReady}/${s.lines.length} lines lip-synced` : ''}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Voice picker
// ---------------------------------------------------------------------------
function VoicePickerModal({ onClose, onSelect }: { onClose: () => void; onSelect: (v: api.VoiceOption) => void }) {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError } = useQuery({ queryKey: ['voices'], queryFn: api.listVoices, retry: false });
  const voices = data?.voices ?? [];
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#1C1C1E', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%', paddingBottom: insets.bottom + spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: `${colors.fog}22` }}>
            <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700' }}>Choose a voice</Text>
            <Pressable testID="voice-picker-close" onPress={onClose} hitSlop={12}><Text style={{ color: colors.bone, fontSize: 20 }}>✕</Text></Pressable>
          </View>
          {isLoading ? (
            <ActivityIndicator color={PURPLE} style={{ margin: spacing.xl }} />
          ) : isError ? (
            <Text style={{ color: colors.signal, padding: spacing.lg }}>Could not load voices. Please retry.</Text>
          ) : (
            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              {voices.map((v) => (
                <Pressable
                  key={v.voice_id}
                  testID={`voice-option-${v.voice_id}`}
                  onPress={() => onSelect(v)}
                  style={{ backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, marginBottom: spacing.sm }}
                >
                  <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600' }}>{v.name}</Text>
                  <Text style={{ color: colors.fog, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                    {[v.gender, v.accent, v.description].filter(Boolean).join(' · ') || 'ElevenLabs voice'}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Video players
// ---------------------------------------------------------------------------
function SceneClipPlayer({ uri, muted = false }: { uri: string; muted?: boolean }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = muted; });
  return <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="cover" nativeControls />;
}

function SequentialPreview({ urls, onClose, ratio }: { urls: string[]; onClose: () => void; ratio: number }) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const player = useVideoPlayer(urls[0] ?? null, (p) => { p.play(); });

  useEffect(() => {
    const sub = player.addListener('playToEnd', () => {
      setIndex((i) => (i + 1 < urls.length ? i + 1 : i));
    });
    return () => sub.remove();
  }, [player, urls.length]);

  useEffect(() => {
    if (urls[index]) {
      player.replace(urls[index]);
      player.play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: '92%', aspectRatio: ratio, maxHeight: '78%', borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
          <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="contain" nativeControls={false} />
        </View>
        <Text style={{ color: colors.bone, marginTop: spacing.md }}>Shot {index + 1} / {urls.length}</Text>
        <Pressable testID="close-preview-player" onPress={onClose} style={{ position: 'absolute', top: insets.top + spacing.md, right: spacing.lg, padding: spacing.sm }}>
          <Text style={{ color: colors.bone, fontSize: 22 }}>✕</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
