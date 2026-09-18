import { colors, spacing } from '@/src/design-system/tokens';
import * as api from '@/src/services/api';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const PURPLE = '#8B5CF6';

const STATUS_META: Record<string, { label: string; color: string }> = {
  NOT_STARTED: { label: 'Not started', color: colors.fog },
  DRAFT: { label: 'Draft', color: colors.fog },
  SYNOPSIS: { label: 'Outlined', color: colors.cobalt },
  ASSETS: { label: 'Scripted', color: colors.cobalt },
  MOTION: { label: 'Filming', color: colors.ochre },
  VOICE: { label: 'Voicing', color: colors.ochre },
  READY: { label: 'Ready', color: '#4ADE80' },
};

export default function SeriesDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [menuVisible, setMenuVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const { data: series, isLoading } = useQuery({
    queryKey: ['series', id],
    queryFn: () => api.getSeries(id!),
    enabled: !!id,
  });

  useFocusEffect(useCallback(() => { qc.invalidateQueries({ queryKey: ['series', id] }); }, [qc, id]));

  const del = useMutation({
    mutationFn: () => api.deleteSeries(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['series'] });
      router.replace('/(tabs)/mylist');
    },
  });

  if (isLoading || !series) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  const readyCount = series.episodes.filter((e) => e.ready).length;

  const openEpisode = (ep: api.EpisodeSummary) => {
    if (ep.locked) {
      Alert.alert('Episode locked', 'Finish generating Episode 1 to unlock the rest of the series.');
      return;
    }
    router.push({ pathname: '/create/pipeline', params: { projectId: series.id, episode: String(ep.episode_number) } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
        <Pressable testID="series-back" onPress={() => router.replace('/(tabs)/mylist')} hitSlop={12} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colors.bone, fontSize: 26 }}>‹</Text>
        </Pressable>
        <Pressable testID="series-menu" onPress={() => setMenuVisible(true)} hitSlop={12} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
          <Text style={{ color: colors.bone, fontSize: 20 }}>⋮</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', marginBottom: spacing.lg }}>
          <View style={{ width: 60, height: 72, backgroundColor: colors.graphite, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md }}>
            <Text style={{ color: colors.fog, fontSize: 22 }}>🎬</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text testID="series-title" style={{ color: colors.bone, fontSize: 18, fontWeight: '700' }}>{series.title || 'Untitled Series'}</Text>
            <Text style={{ color: colors.fog, fontSize: 13, marginTop: spacing.xs }}>{readyCount} of {series.total_episodes} episodes ready</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ backgroundColor: colors.graphite, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 4 }}>
                <Text style={{ color: colors.bone, fontSize: 11 }}>{series.orientation === 'horizontal' ? '16:9' : '9:16'}</Text>
              </View>
              <View style={{ backgroundColor: colors.graphite, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 4 }}>
                <Text style={{ color: colors.bone, fontSize: 11 }}>{series.art_style}</Text>
              </View>
            </View>
          </View>
        </View>

        {!!series.prompt && (
          <>
            <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm }}>Premise</Text>
            <Text style={{ color: colors.fog, fontSize: 13, lineHeight: 20 }} numberOfLines={expanded ? undefined : 3}>{series.prompt}</Text>
            {series.prompt.length > 120 && (
              <Pressable onPress={() => setExpanded(!expanded)}>
                <Text style={{ color: colors.bone, fontSize: 13, fontWeight: '600', marginTop: spacing.xs }}>{expanded ? 'Collapse' : 'Expand'}</Text>
              </Pressable>
            )}
          </>
        )}

        <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.md }}>Episodes</Text>
        {series.episodes.map((ep) => {
          const meta = STATUS_META[ep.status] ?? STATUS_META.NOT_STARTED;
          return (
            <Pressable
              key={ep.episode_number}
              testID={`episode-row-${ep.episode_number}`}
              onPress={() => openEpisode(ep)}
              style={{
                backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, marginBottom: spacing.sm,
                flexDirection: 'row', alignItems: 'center', opacity: ep.locked ? 0.55 : 1,
              }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: ep.locked ? `${colors.fog}22` : PURPLE, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md }}>
                <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '700' }}>{ep.locked ? '🔒' : ep.episode_number}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.bone, fontSize: 15, fontWeight: '600' }}>Episode {ep.episode_number}</Text>
                <Text style={{ color: meta.color, fontSize: 12, marginTop: 2 }}>{ep.locked ? 'Locked' : meta.label}</Text>
              </View>
              <Text style={{ color: colors.fog, fontSize: 16 }}>›</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md }}>
        <Pressable
          testID="open-episode-1-button"
          onPress={() => openEpisode(series.episodes[0])}
          style={{ backgroundColor: PURPLE, paddingVertical: spacing.md, borderRadius: 24, alignItems: 'center' }}
        >
          <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>
            {series.ep1_ready ? 'Open Episode 1' : 'Generate Episode 1'}
          </Text>
        </Pressable>
      </View>

      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setMenuVisible(false)}>
          <View style={{ position: 'absolute', top: insets.top + 50, right: spacing.lg, backgroundColor: colors.graphite, borderRadius: 8, overflow: 'hidden', minWidth: 150 }}>
            <Pressable
              testID="delete-series"
              onPress={() => { setMenuVisible(false); del.mutate(); }}
              style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md }}
            >
              <Text style={{ color: colors.signal, marginRight: spacing.sm }}>🗑</Text>
              <Text style={{ color: colors.signal, fontSize: 14 }}>Delete Series</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
