import { colors, spacing } from '@/src/design-system/tokens';
import * as api from '@/src/services/api';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVideoPlayer, VideoView } from 'expo-video';

const STEPS = ['Synopsis', 'Script', 'Asset', 'Storyboard', 'Preview'];
const PURPLE = '#8B5CF6';

function computeStep(p: api.Project): number {
  if (!p.synopsis) return 1;
  if (p.status !== 'SCRIPTED' || p.scenes.length === 0) return 2;
  const charsDone = p.characters.length > 0 && p.characters.every((c) => c.image_url);
  if (!charsDone) return 3;
  const boardsDone = p.scenes.every((s) => s.storyboard_url);
  if (!boardsDone) return 4;
  return 5;
}

export default function Pipeline() {
  const insets = useSafeAreaInsets();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const qc = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  });

  const refetch = () => qc.invalidateQueries({ queryKey: ['project', projectId] });

  // Initialise step from project state (once).
  useEffect(() => {
    if (project && currentStep === 0) setCurrentStep(computeStep(project));
  }, [project, currentStep]);

  const ratio = project?.orientation === 'horizontal' ? 16 / 9 : 9 / 16;

  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refetch();
    } catch (e: any) {
      setError(e?.message || 'Something went wrong. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  // Auto-generate synopsis / script when entering an empty step.
  const autoRef = useRef<Record<number, boolean>>({});
  useEffect(() => {
    if (!project || busy) return;
    if (currentStep === 1 && !project.synopsis && !autoRef.current[1]) {
      autoRef.current[1] = true;
      run(() => api.generateSynopsis(project.id));
    }
    if (currentStep === 2 && project.synopsis && project.scenes.length === 0 && !autoRef.current[2]) {
      autoRef.current[2] = true;
      run(() => api.generateScript(project.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, project?.synopsis, project?.scenes.length]);

  const goNext = () => {
    if (currentStep < 5) setCurrentStep(currentStep + 1);
    else router.replace({ pathname: '/project/[id]', params: { id: project!.id } });
  };

  if (isLoading || !project) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  const generatingHeadline =
    currentStep === 1 ? 'Creating story outline...' :
    currentStep === 2 ? 'Writing the script...' : 'Working...';

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, paddingTop: insets.top }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
        <Pressable
          testID="pipeline-close-button"
          onPress={() => router.replace({ pathname: '/project/[id]', params: { id: project.id } })}
          hitSlop={12}
          style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: colors.bone, fontSize: 20 }}>✕</Text>
        </Pressable>
        <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
          {project.title || 'New Drama'}
        </Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Step progress */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
        {STEPS.map((step, index) => (
          <View key={step} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: index + 1 <= currentStep ? PURPLE : 'transparent', borderWidth: index + 1 <= currentStep ? 0 : 1, borderColor: colors.fog, justifyContent: 'center', alignItems: 'center' }}>
                {index + 1 < currentStep
                  ? <Text style={{ color: colors.bone, fontSize: 12 }}>✓</Text>
                  : <Text style={{ color: index + 1 <= currentStep ? colors.bone : colors.fog, fontSize: 12, fontWeight: '600' }}>{index + 1}</Text>}
              </View>
              <Text style={{ color: index + 1 === currentStep ? colors.bone : colors.fog, fontSize: 9, marginTop: spacing.xs }}>{step}</Text>
            </View>
            {index < STEPS.length - 1 && (
              <View style={{ width: 14, height: 1, backgroundColor: index + 1 < currentStep ? PURPLE : `${colors.fog}44`, marginHorizontal: 2, marginBottom: spacing.md }} />
            )}
          </View>
        ))}
      </View>

      {error ? (
        <View style={{ backgroundColor: `${colors.signal}22`, marginHorizontal: spacing.lg, padding: spacing.sm, borderRadius: 6 }}>
          <Text testID="pipeline-error" style={{ color: colors.signal, fontSize: 12 }}>{error}</Text>
        </View>
      ) : null}

      {/* Content */}
      {busy && (currentStep === 1 || currentStep === 2) ? (
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
              <Text testID="synopsis-title" style={{ color: colors.bone, fontSize: 20, fontWeight: '700', marginBottom: spacing.md }}>{project.title}</Text>
              <Text style={{ color: colors.fog, fontSize: 14, lineHeight: 22 }}>{project.synopsis}</Text>
              <Pressable testID="regenerate-synopsis" disabled={busy} onPress={() => run(() => api.generateSynopsis(project.id))} style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }}>
                <Text style={{ color: PURPLE, fontSize: 14, fontWeight: '600' }}>↻ Regenerate synopsis</Text>
              </Pressable>
            </View>
          )}

          {currentStep === 2 && (
            <View>
              <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm }}>Characters</Text>
              {project.characters.map((c) => (
                <View key={c.id} style={{ backgroundColor: colors.graphite, padding: spacing.md, borderRadius: 8, marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.bone, fontWeight: '700' }}>{c.name} <Text style={{ color: colors.fog, fontWeight: '400' }}>· {c.role}</Text></Text>
                  <Text style={{ color: colors.fog, fontSize: 12, marginTop: spacing.xs, lineHeight: 18 }}>{c.detailed_visual_profile}</Text>
                </View>
              ))}
              <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginVertical: spacing.md }}>Scene Breakdown</Text>
              {project.scenes.map((s) => (
                <View key={s.scene_number} style={{ backgroundColor: colors.graphite, padding: spacing.md, borderRadius: 8, marginBottom: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: PURPLE, justifyContent: 'center', alignItems: 'center', marginRight: spacing.sm }}>
                      <Text style={{ color: colors.bone, fontSize: 11, fontWeight: '700' }}>{s.scene_number}</Text>
                    </View>
                    <Text style={{ color: colors.bone, fontSize: 12, fontWeight: '700', flex: 1 }}>{s.heading}</Text>
                  </View>
                  <Text style={{ color: colors.fog, fontSize: 13, lineHeight: 19 }}>{s.description}</Text>
                  {!!s.dialogue && <Text style={{ color: colors.ochre, fontSize: 12, marginTop: spacing.xs, fontStyle: 'italic' }}>“{s.dialogue}”</Text>}
                </View>
              ))}
              <Pressable testID="regenerate-script" disabled={busy} onPress={() => run(() => api.generateScript(project.id))} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
                <Text style={{ color: PURPLE, fontSize: 14, fontWeight: '600' }}>↻ Regenerate script</Text>
              </Pressable>
            </View>
          )}

          {currentStep === 3 && (
            <View>
              <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.md }}>Character Designs</Text>
              {project.characters.map((c) => (
                <View key={c.id} style={{ backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, marginBottom: spacing.md, flexDirection: 'row' }}>
                  <View style={{ width: 72, height: 96, borderRadius: 8, overflow: 'hidden', backgroundColor: `${colors.fog}22`, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md }}>
                    {c.image_url
                      ? <Image source={{ uri: c.image_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      : <Text style={{ color: colors.fog, fontSize: 22 }}>👤</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.bone, fontWeight: '700' }}>{c.name}</Text>
                    <Text style={{ color: colors.fog, fontSize: 11, marginTop: spacing.xs, lineHeight: 16 }} numberOfLines={4}>{c.detailed_visual_profile}</Text>
                    <Pressable
                      testID={`generate-character-${c.id}`}
                      disabled={busy}
                      onPress={() => run(() => api.generateCharacterImage(project.id, c.id))}
                      style={{ marginTop: spacing.sm, alignSelf: 'flex-start', backgroundColor: PURPLE, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 14 }}
                    >
                      <Text style={{ color: colors.bone, fontSize: 12, fontWeight: '600' }}>{c.image_url ? 'Regenerate' : 'Generate'}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              {busy && <ActivityIndicator color={PURPLE} style={{ marginTop: spacing.md }} />}
            </View>
          )}

          {currentStep === 4 && (
            <View>
              <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.md }}>Storyboard</Text>
              {project.scenes.map((s) => (
                <View key={s.scene_number} style={{ marginBottom: spacing.lg }}>
                  <View style={{ aspectRatio: ratio, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.graphite, justifyContent: 'center', alignItems: 'center', maxHeight: 360, alignSelf: 'stretch' }}>
                    {s.storyboard_url
                      ? <Image source={{ uri: s.storyboard_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      : <Text style={{ color: colors.fog }}>Scene {s.scene_number}</Text>}
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
                    <Text style={{ color: colors.fog, fontSize: 12, flex: 1 }} numberOfLines={1}>{s.scene_number}. {s.heading}</Text>
                    <Pressable
                      testID={`generate-storyboard-${s.scene_number}`}
                      disabled={busy}
                      onPress={() => run(() => api.generateStoryboard(project.id, s.scene_number))}
                      style={{ backgroundColor: PURPLE, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 14 }}
                    >
                      <Text style={{ color: colors.bone, fontSize: 12, fontWeight: '600' }}>{s.storyboard_url ? 'Regenerate' : 'Generate'}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              {busy && <ActivityIndicator color={PURPLE} />}
            </View>
          )}

          {currentStep === 5 && (
            <PreviewStep project={project} ratio={ratio} onRefetch={refetch} setError={setError} />
          )}
        </ScrollView>
      )}

      {/* Bottom button */}
      <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md }}>
        <Pressable
          testID="pipeline-next-button"
          onPress={goNext}
          disabled={busy}
          style={{ backgroundColor: busy ? `${colors.fog}44` : PURPLE, paddingVertical: spacing.md, borderRadius: 24, alignItems: 'center' }}
        >
          <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>
            {busy ? 'Working...' : currentStep === 5 ? 'Finish' : `Next: ${STEPS[currentStep]}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Preview step (per-scene silent clip generation + playback)
// ---------------------------------------------------------------------------
function PreviewStep({ project, ratio, onRefetch, setError }: {
  project: api.Project; ratio: number; onRefetch: () => void; setError: (s: string) => void;
}) {
  const [starting, setStarting] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const pending = project.scenes.filter(
    (s) => s.clip && (s.clip.status === 'QUEUED' || s.clip.status === 'PROCESSING'));

  // Poll pending clips.
  useEffect(() => {
    if (pending.length === 0) return;
    const t = setInterval(async () => {
      try {
        await Promise.all(pending.map((s) => api.pollSceneVideo(project.id, s.scene_number)));
      } catch { /* ignore transient */ }
      onRefetch();
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.map((s) => s.scene_number).join(','), project.id]);

  const startClip = async (sceneNumber: number) => {
    setStarting(sceneNumber);
    setError('');
    try {
      await api.startSceneVideo(project.id, sceneNumber);
      onRefetch();
    } catch (e: any) {
      setError(e?.message || 'Could not start the render.');
    } finally {
      setStarting(null);
    }
  };

  const readyUrls = project.scenes
    .filter((s) => s.clip?.status === 'READY' && s.clip.video_url)
    .map((s) => s.clip!.video_url!) as string[];

  return (
    <View>
      <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.xs }}>Silent Preview</Text>
      <Text style={{ color: colors.fog, fontSize: 12, marginBottom: spacing.md }}>
        Each scene renders a ~5s silent motion clip. Rendering takes a couple of minutes per scene.
      </Text>

      {readyUrls.length > 0 && (
        <Pressable
          testID="play-preview-button"
          onPress={() => setPlaying(true)}
          style={{ backgroundColor: colors.signal, paddingVertical: spacing.md, borderRadius: 10, alignItems: 'center', marginBottom: spacing.lg }}
        >
          <Text style={{ color: colors.bone, fontWeight: '700' }}>▶ Play preview ({readyUrls.length} scene{readyUrls.length > 1 ? 's' : ''})</Text>
        </Pressable>
      )}

      {project.scenes.map((s) => {
        const clip = s.clip;
        const status = clip?.status;
        return (
          <View key={s.scene_number} style={{ marginBottom: spacing.lg }}>
            <View style={{ aspectRatio: ratio, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.graphite, justifyContent: 'center', alignItems: 'center', maxHeight: 360 }}>
              {status === 'READY' && clip?.video_url ? (
                <SceneClipPlayer uri={clip.video_url} />
              ) : s.storyboard_url ? (
                <Image source={{ uri: s.storyboard_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <Text style={{ color: colors.fog }}>No storyboard</Text>
              )}
              {(status === 'QUEUED' || status === 'PROCESSING') && (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator color={colors.bone} />
                  <Text style={{ color: colors.bone, fontSize: 12, marginTop: spacing.sm }}>Rendering…</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
              <Text style={{ color: colors.fog, fontSize: 12, flex: 1 }} numberOfLines={1}>{s.scene_number}. {s.heading}</Text>
              {status !== 'QUEUED' && status !== 'PROCESSING' && (
                <Pressable
                  testID={`generate-clip-${s.scene_number}`}
                  disabled={!s.storyboard_url || starting === s.scene_number}
                  onPress={() => startClip(s.scene_number)}
                  style={{ backgroundColor: s.storyboard_url ? PURPLE : `${colors.fog}44`, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 14 }}
                >
                  <Text style={{ color: colors.bone, fontSize: 12, fontWeight: '600' }}>
                    {starting === s.scene_number ? '…' : status === 'READY' ? 'Re-render' : status === 'FAILED' ? 'Retry' : 'Generate clip'}
                  </Text>
                </Pressable>
              )}
            </View>
            {clip?.error ? <Text style={{ color: colors.signal, fontSize: 11, marginTop: spacing.xs }}>{clip.error}</Text> : null}
          </View>
        );
      })}

      {playing && <SequentialPreview urls={readyUrls} onClose={() => setPlaying(false)} ratio={ratio} />}
    </View>
  );
}

function SceneClipPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.muted = true; });
  return <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="cover" nativeControls />;
}

function SequentialPreview({ urls, onClose, ratio }: { urls: string[]; onClose: () => void; ratio: number }) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const player = useVideoPlayer(urls[0] ?? null, (p) => { p.muted = true; p.play(); });

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
        <Text style={{ color: colors.bone, marginTop: spacing.md }}>Scene {index + 1} / {urls.length}</Text>
        <Pressable testID="close-preview-player" onPress={onClose} style={{ position: 'absolute', top: insets.top + spacing.md, right: spacing.lg, padding: spacing.sm }}>
          <Text style={{ color: colors.bone, fontSize: 22 }}>✕</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
