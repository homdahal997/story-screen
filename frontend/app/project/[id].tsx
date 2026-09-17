import { colors, spacing } from '@/src/design-system/tokens';
import * as api from '@/src/services/api';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const PURPLE = '#8B5CF6';

function sceneStatus(s: api.Scene): { label: string; color: string } {
  if (s.clip?.status === 'READY') return { label: 'Clip Ready', color: '#4ADE80' };
  if (s.clip?.status === 'PROCESSING' || s.clip?.status === 'QUEUED') return { label: 'Rendering', color: colors.ochre };
  if (s.storyboard_url) return { label: 'Storyboard', color: colors.cobalt };
  return { label: 'Pending', color: colors.fog };
}

export default function ProjectDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [menuVisible, setMenuVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.getProject(id!),
    enabled: !!id,
  });

  const del = useMutation({
    mutationFn: () => api.deleteProject(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      router.replace('/(tabs)/mylist');
    },
  });

  if (isLoading || !project) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  const ratio = project.orientation === 'horizontal' ? 16 / 9 : 9 / 16;
  const readyCount = project.scenes.filter((s) => s.clip?.status === 'READY').length;
  const statusLabel = project.status === 'SCRIPTED' ? 'In Production' : project.status === 'SYNOPSIS' ? 'Outlined' : 'Draft';

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
        <Pressable testID="project-back" onPress={() => router.replace('/(tabs)/mylist')} hitSlop={12} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colors.bone, fontSize: 26 }}>‹</Text>
        </Pressable>
        <Pressable testID="project-menu" onPress={() => setMenuVisible(true)} hitSlop={12} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
          <Text style={{ color: colors.bone, fontSize: 20 }}>⋮</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', marginBottom: spacing.lg }}>
          <View style={{ width: 60, height: 72, backgroundColor: colors.graphite, borderRadius: 8, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', marginRight: spacing.md }}>
            {project.scenes[0]?.storyboard_url
              ? <Image source={{ uri: project.scenes[0].storyboard_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              : <Text style={{ color: colors.fog, fontSize: 22 }}>🎬</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text testID="project-title" style={{ color: colors.bone, fontSize: 18, fontWeight: '700' }}>{project.title || 'Untitled Project'}</Text>
            <Text style={{ color: colors.fog, fontSize: 13, marginTop: spacing.xs }}>{readyCount} of {project.scenes.length || project.scene_count} Scenes Ready</Text>
            <View style={{ backgroundColor: colors.graphite, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start', marginTop: spacing.sm }}>
              <Text style={{ color: colors.bone, fontSize: 11 }}>{statusLabel}</Text>
            </View>
          </View>
        </View>

        {!!project.synopsis && (
          <>
            <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm }}>Story Synopsis</Text>
            <Text style={{ color: colors.fog, fontSize: 13, lineHeight: 20 }} numberOfLines={expanded ? undefined : 3}>{project.synopsis}</Text>
            <Pressable onPress={() => setExpanded(!expanded)}>
              <Text style={{ color: colors.bone, fontSize: 13, fontWeight: '600', marginTop: spacing.xs }}>{expanded ? 'Collapse' : 'Expand'}</Text>
            </Pressable>
          </>
        )}

        <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.md }}>Scenes</Text>
        {project.scenes.length === 0 ? (
          <Text style={{ color: colors.fog, fontSize: 13 }}>No scenes yet — continue in the studio to generate the script.</Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            {project.scenes.map((s) => {
              const st = sceneStatus(s);
              return (
                <Pressable
                  key={s.scene_number}
                  testID={`scene-card-${s.scene_number}`}
                  onPress={() => router.push({ pathname: '/create/pipeline', params: { projectId: project.id } })}
                  style={{ width: '30%' }}
                >
                  <View style={{ aspectRatio: ratio > 1 ? 1 : 0.72, backgroundColor: colors.graphite, borderRadius: 8, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
                    {s.storyboard_url
                      ? <Image source={{ uri: s.storyboard_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      : <Text style={{ color: colors.fog, fontSize: 24 }}>+</Text>}
                  </View>
                  <Text style={{ color: colors.bone, fontSize: 11, marginTop: spacing.xs }}>Scene {s.scene_number}</Text>
                  <Text style={{ color: st.color, fontSize: 9 }}>{st.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md }}>
        <Pressable
          testID="continue-studio-button"
          onPress={() => router.push({ pathname: '/create/pipeline', params: { projectId: project.id } })}
          style={{ backgroundColor: PURPLE, paddingVertical: spacing.md, borderRadius: 24, alignItems: 'center' }}
        >
          <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>Continue in Studio</Text>
        </Pressable>
      </View>

      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setMenuVisible(false)}>
          <View style={{ position: 'absolute', top: insets.top + 50, right: spacing.lg, backgroundColor: colors.graphite, borderRadius: 8, overflow: 'hidden', minWidth: 140 }}>
            <Pressable
              testID="delete-project"
              onPress={() => { setMenuVisible(false); del.mutate(); }}
              style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md }}
            >
              <Text style={{ color: colors.signal, marginRight: spacing.sm }}>🗑</Text>
              <Text style={{ color: colors.signal, fontSize: 14 }}>Delete Project</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
