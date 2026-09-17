import { colors, spacing } from '@/src/design-system/tokens';
import * as api from '@/src/services/api';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const PURPLE = '#8B5CF6';

function statusLabel(p: api.Project): string {
  if (p.status === 'SCRIPTED') return 'In Production';
  if (p.status === 'SYNOPSIS') return 'Outlined';
  return 'Draft';
}

export default function MyList() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data: projects, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['projects'],
    queryFn: api.listProjects,
  });

  useFocusEffect(useCallback(() => { qc.invalidateQueries({ queryKey: ['projects'] }); }, [qc]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, paddingTop: insets.top }}>
      <View style={{ padding: spacing.lg }}>
        <Text style={{ color: colors.bone, fontSize: 24, fontWeight: '700' }}>My Projects</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.fog} />}
      >
        {isLoading ? (
          <ActivityIndicator color={PURPLE} style={{ marginTop: spacing.xxl }} />
        ) : !projects || projects.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: spacing.xxl }}>
            <Text style={{ color: colors.fog, fontSize: 16 }}>No projects yet</Text>
            <Pressable
              testID="mylist-create-first"
              onPress={() => router.push('/(tabs)/studio')}
              style={{ marginTop: spacing.lg, backgroundColor: PURPLE, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 24 }}
            >
              <Text style={{ color: colors.bone, fontWeight: '600' }}>Create Your First Project</Text>
            </Pressable>
          </View>
        ) : (
          projects.map((project) => {
            const ready = project.scenes.filter((s) => s.clip?.status === 'READY').length;
            const poster = project.scenes.find((s) => s.storyboard_url)?.storyboard_url;
            return (
              <Pressable
                key={project.id}
                testID={`project-row-${project.id}`}
                onPress={() => router.push({ pathname: '/project/[id]', params: { id: project.id } })}
                style={{ backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center' }}
              >
                <View style={{ width: 50, height: 62, backgroundColor: `${colors.fog}22`, borderRadius: 6, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', marginRight: spacing.md }}>
                  {poster ? <Image source={{ uri: poster }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Text style={{ color: colors.fog, fontSize: 20 }}>🎬</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{project.title || 'Untitled'}</Text>
                  <Text style={{ color: colors.fog, fontSize: 12, marginTop: spacing.xs }}>{ready} of {project.scenes.length || project.scene_count} Scenes Ready</Text>
                  <View style={{ backgroundColor: `${colors.fog}33`, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start', marginTop: spacing.sm }}>
                    <Text style={{ color: colors.bone, fontSize: 10 }}>{statusLabel(project)}</Text>
                  </View>
                </View>
                <Text style={{ color: colors.fog, fontSize: 16 }}>›</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
