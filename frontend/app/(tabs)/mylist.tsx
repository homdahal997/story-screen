import { colors, spacing } from '@/src/design-system/tokens';
import * as api from '@/src/services/api';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const PURPLE = '#8B5CF6';

function seriesStatus(s: api.Series): { label: string; color: string } {
  const ready = s.episodes.filter((e) => e.ready).length;
  if (ready > 0) return { label: `${ready} of ${s.total_episodes} episodes ready`, color: '#4ADE80' };
  const started = s.episodes.some((e) => e.started);
  if (started) return { label: 'Episode 1 in progress', color: colors.ochre };
  return { label: 'Not started', color: colors.fog };
}

export default function MyList() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data: series, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['series'],
    queryFn: api.listSeries,
  });

  useFocusEffect(useCallback(() => { qc.invalidateQueries({ queryKey: ['series'] }); }, [qc]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, paddingTop: insets.top }}>
      <View style={{ padding: spacing.lg }}>
        <Text style={{ color: colors.bone, fontSize: 24, fontWeight: '700' }}>My Series</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.fog} />}
      >
        {isLoading ? (
          <ActivityIndicator color={PURPLE} style={{ marginTop: spacing.xxl }} />
        ) : !series || series.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: spacing.xxl }}>
            <Text style={{ color: colors.fog, fontSize: 16 }}>No series yet</Text>
            <Pressable
              testID="mylist-create-first"
              onPress={() => router.push('/(tabs)/studio')}
              style={{ marginTop: spacing.lg, backgroundColor: PURPLE, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 24 }}
            >
              <Text style={{ color: colors.bone, fontWeight: '600' }}>Create Your First Series</Text>
            </Pressable>
          </View>
        ) : (
          series.map((s) => {
            const st = seriesStatus(s);
            return (
              <Pressable
                key={s.id}
                testID={`series-row-${s.id}`}
                onPress={() => router.push({ pathname: '/project/[id]', params: { id: s.id } })}
                style={{ backgroundColor: colors.graphite, borderRadius: 8, padding: spacing.md, marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center' }}
              >
                <View style={{ width: 50, height: 62, backgroundColor: `${colors.fog}22`, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md }}>
                  <Text style={{ color: colors.fog, fontSize: 20 }}>🎬</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{s.title || 'Untitled Series'}</Text>
                  <Text style={{ color: colors.fog, fontSize: 12, marginTop: spacing.xs }}>{s.total_episodes} episodes</Text>
                  <View style={{ backgroundColor: `${colors.fog}22`, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start', marginTop: spacing.sm }}>
                    <Text style={{ color: st.color, fontSize: 10 }}>{st.label}</Text>
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
